// SkUsersDb.mjs
// This file is used to manage the users database
// It is used to store the users data

import { ObjectId } from '@fastify/mongodb'


export async function SkUsersDb(fastify,opts) {
  
  fastify.post('/users/post', async function (req, reply) {
    console.log(req.body);
    const wCollection = fastify.mongo.db.collection('users')
    const wObj=JSON.parse(req.body);
    const wResult = await wCollection.insertOne(wObj);
    console.log(wResult);
    console.log(`A document was inserted with the _id: ${wResult.insertedId}`)
    
    let wSearchId={}
    wSearchId._id=wResult.insertedId
    let wKey=JSON.stringify(wSearchId)
    const wCursor=wCollection.find(wSearchId)
    // Print returned documents ===========================
    for await (const doc of wCursor) {
      console.log(doc);
    }

    let wResultRet={message:'success' };
    return(wResultRet);
  })


  fastify.get('/users/:id', async function (req, reply) {
    const wCollection = fastify.mongo.db.collection('users')
    
    // Set Query
    const wQuery = { m_Name: req.params.id }
    const wOptions = {
      // Sort returned documents in ascending order by title (A->Z)
      sort: { m_Name: 1 },
      // Include only the `name` and `surname` fields in each returned document
      projection: { _id: 0, m_Name: 1, m_Surname: 2, m_Email: 3 }
    };

    try {
      const wCursor = await wCollection.find(wQuery,wOptions)
      let wUsers={}
      wUsers.message='success'
      wUsers.data= await wCursor.toArray();
      /*
       // Print a message if no documents were found
      if ((await wCollection.countDocuments(wQuery)) === 0) {
        console.log("No documents found!");
        wUsers.push({ message : "No documents found!" })
      }
      */

      // Return collection of user
      return wUsers
    } catch (err) {
      // Return error
      let wError={}
      wError.message='error'
      wError.error=err
      return wError
    }
  })
}

