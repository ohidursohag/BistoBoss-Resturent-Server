const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5001
const app = express();


// middleware
app.use(cors({
   origin: [
      "http://localhost:5173",
      "http://localhost:5174",
   ],
   credentials: true,
}));
app.use(express.json());
app.use(cookieParser())

// Verify Access Token
const verifyToken = async (req, res, next) => {
   const accessToken = req.cookies?.accessToken;
   // console.log('Value of Access Token in MiddleWare -------->', accessToken);
   if (!accessToken) {
      return res.status(401).send({ message: 'UnAuthorized Access', code: 401 });
   }
   jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
      if (error) {
         return res.status(401).send({ message: 'UnAuthorized Access', code: 401 });
      }
      req.user = decoded;

      next();
   })
}
// Verify Admin
const verifyAdmin = async (req, res, next) => {
   const email = req.user?.email
   const query = { email: email };
   const user = await userCollection.findOne(query);
   const isAdmin = user?.role === 'admin';
   if (!isAdmin) {
      return res.status(403).send({ message: 'Forbidden Access', code: 403 });
   }
   next();
}



const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
   serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
   }
});

async function run() {
   try {
      // Connect the client to the server	(optional starting in v4.7)
      client.connect();
      // Send a ping to confirm a successful connection
      client.db("admin").command({ ping: 1 });
      console.log("Pinged your deployment. You successfully connected to MongoDB!");
   } finally {
      // Ensures that the client will close when you finish/error
      // await client.close();
   }
}
run().catch(console.dir);

// Database collection
const allMenuItemsCollection = client.db('bistroBossDB').collection('allMenuItems');
const reviewCollection = client.db('bistroBossDB').collection('reviews');
const cartCollection = client.db('bistroBossDB').collection('cartItems');
const userCollection = client.db('bistroBossDB').collection('users');


// JWT:: Create Access token 
app.post('/bistro-boss/api/v1/auth/access-token', async (req, res) => {
   const user = req.body;
   console.log('Requested access token User ------>', user);
   const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
      expiresIn: '10d',
   })
   res.cookie('accessToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
   }).send({ success: true });
})

// Clear access token when user logged out
app.get('/bistro-boss/api/v1/logout', async (req, res) => {
   try {
      res.clearCookie('accessToken', {
         maxAge: 0,
         secure: process.env.NODE_ENV === 'production',
         sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
      }).send({ success: true });
   } catch (error) {
      return res.send({ error: true, error: error.message });
   }
})

// Creat Patment Intent
app.post('/bistro-boss/api/v1/create-payment-intent', verifyToken, async (req, res) => {
   try {
      const { price } = req.body;
      const amount = Number(price * 100);
      if (!price || amount < 1) return;
      const { client_secret } = await stripe.paymentIntents.create({
         amount: amount,
         currency: 'usd',
         payment_method_types: ['card'],
      })
      res.send({ clientSecret: client_secret })
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
})

// ----------User Collection api start------------
// Save or modify user email, status in DB
app.put('/bistro-boss/api/v1/create-or-update-user/:email', verifyToken, async (req, res) => {
   try {

      const email = req.params.email;
      const user = req.body;
      if (email !== req.user?.email) {
         return res.status(403).send({ message: 'Forbidden Access', code: 403 });
      }
      // console.log(user);
      const query = { email: email };
      const option = { upsert: true };
      const isExist = await userCollection.findOne(query);
      const updateDoc = {
         $set: { ...user }
      }
      // console.log(updateDoc);
      // console.log('User found?----->', isExist)
      if (isExist) {
         return res.send('User Alredy exist ------>')
      }
      const result = await userCollection.updateOne(query, updateDoc, option);
      console.log('user updated?----->', result);
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
})
// get single user
app.get('/bistro-boss/api/v1/get-user-data/:email', verifyToken, async (req, res) => {
   try {
      const email = req.params.email;
      if (email !== req.user?.email) {
         return res.status(403).send({ message: 'Forbidden Access', code: 403 })
      }
      const query = { email: email };
      const result = await userCollection.findOne(query);
      //   console.log('user data -------->',result);
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
})
// Delete a user
app.delete('/bistro-boss/api/v1/delete-user/:id', verifyToken, verifyAdmin, async (req, res) => {
   try {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
});
// make Admin
app.patch('/bistro-boss/api/v1/make-admin/:id', verifyToken, verifyAdmin, async (req, res) => {
   try {
      const { id } = req.params;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
         $set: { role: 'admin' }
      }
      const result = await userCollection.updateOne(filter, updatedDoc);
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
})
// get all users
app.get('/bistro-boss/api/v1/all-users', verifyToken, verifyAdmin, async (req, res) => {
   try {
      // console.log(req.user);
      // console.log('Token in api ------>', req.cookies?.accessToken);
      const result = await userCollection.find().toArray()
      return res.send(result)
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
})
// --------User Collection api end---------


// -------------All menu items collection ApIs start--------------

// GET:: All Menu items
app.get('/bistro-boss/api/v1/menu-items', async (req, res) => {
   try {
      const result = await allMenuItemsCollection.find().toArray();
      // console.log('Menu Item Hitting ---> ', result);
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
});

// GET::  Menu items by 
app.get('/bistro-boss/api/v1/menu-item/:id', async (req, res) => {
   try {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) }
      // console.log(id);
      const result = await allMenuItemsCollection.findOne(query);
      // console.log(result);
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
});

// Post:: Add menu item
app.post('/bistro-boss/api/v1/add-menu-item', verifyToken, verifyAdmin, async (req, res) => {
   try {
      const menuItem = req.body;
      const result = await allMenuItemsCollection.insertOne(menuItem);
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }

})


// Patch:: update menu item

app.patch('/bistro-boss/api/v1/update-menu-item/:id', verifyToken, verifyAdmin, async (req, res) => {
   try {
      const { id } = req.params;
      const updatedMenuData = req.body
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = { $set: { ...updatedMenuData } }
      const result = await allMenuItemsCollection.updateOne(filter, updatedDoc);
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
})

// Delete:: Menu items by id
app.delete('/bistro-boss/api/v1/delete-menu-item/:id', verifyToken, verifyAdmin, async (req, res) => {
   try {
      const id = req.params.id;
      // console.log(id);
      const query = { _id: new ObjectId(id) }
      const result = await allMenuItemsCollection.deleteOne(query);
      // console.log(result);
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
})
// -----------All menu items collection ApIs End------------


// ----------Review items collection Apis Start-------
// GET:: All Menu items
app.get('/bistro-boss/api/v1/reviews', async (req, res) => {
   try {
      // console.log("Hit get Review api");
      const result = await reviewCollection.find().toArray();
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
});
// ----------Review items collection Apis End-----------


// ----------Cart items collection Apis Start-------
app.post('/bistro-boss/api/v1/add-cart-item', verifyToken, async (req, res) => {
   try {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem)
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
})

app.get('/bistro-boss/api/v1/user/cart-Items', verifyToken, async (req, res) => {
   try {
      const email = req.query.email;
      // console.log(email);
      let query = {}
      if (email) {
         query = { email: email }
      }
      const result = await cartCollection.find(query).toArray();
      res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
})

app.delete('/bistro-boss/api/v1/delete-cart-item/:id', verifyToken, async (req, res) => {
   try {
      const id = req.params.id
      //   console.log(id);
      const query = { _id: new ObjectId(id) }
      const result = await cartCollection.deleteOne(query)
      //   console.log(result);
      return res.send(result);
   } catch (error) {
      return res.send({ error: true, message: error.message });
   }
})

// -------Cart items collection Apis End-----------










// Test Api
app.get('/', (req, res) => {
   res.send('Server is Running');
})
app.listen(port, () => {
   console.log(`server listening on port ${port}`);
});