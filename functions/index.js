const functions = require("firebase-functions");
const admin = require("firebase-admin");
const geolib = require("geolib");
admin.initializeApp();
const db = admin.firestore();
const customersRef = db.collection("customers");
const ridersRef = db.collection("riders");

exports.onUserStatusChange = functions.database
    .ref("/{uid}/presence")
    .onUpdate(async (change, context) => {
    // Get the data written to Realtime Database
      const isOnline = change.after.val();

      // Then use other event data to create a reference to the
      // corresponding Firestore document.
      const userStatusFirestoreRef = db.doc(`users/${context.params.uid}`);

      console.log(`status: ${isOnline}`);

      return userStatusFirestoreRef.update({
        presence: isOnline,
        last_seen: Date.now(),
      });
    });

exports.handleRequests = functions.https.onRequest( async (req, res) => {
  try {
    const requestId = req.query.reqId;
    const customerId = req.query.customerId;
    const ridersLocRef = await admin.database().ref("available_riders");
    let ridersLocations;
    let distance;
    let riderToken;

    const requestDoc = customersRef.doc(customerId)
        .collection("requests").doc(requestId);

    const requestInfo = await requestDoc.get();

    const deliveryLocation = {
      latitude: requestInfo.data().destination["latitude"],
      longitude: requestInfo.data().destination["longitude"],
    };
    const deliveryAddress = requestInfo.data().destination_address;

    await ridersLocRef.once("value", (snapshot) => {
      ridersLocations = snapshot.val();
    });

    for (const i in ridersLocations) {
      if (Object.prototype.hasOwnProperty.call(ridersLocations, i)) {
        const rider = await ridersRef.doc(i).get();
        if (rider.data().status == "available") {
          const riderCoord = ridersLocations[i]["l"];
          const riderLocation = {latitude: riderCoord[0],
            longitude: riderCoord[1]};
          const distanceCheck = await geolib.getDistance(riderLocation,
              deliveryLocation);
          if (!distance) {
            distance = distanceCheck;
            riderToken = await rider.data().fcmToken;
          } else if (distance > distanceCheck) {
            distance = distanceCheck;
            riderToken = await rider.data().fcmToken;
          }
        }
      }
    }


    const message = {
      "token": riderToken,
      "notification": {
        "body": deliveryAddress,
        "title": "New Ride Request",
      },
      "data": {
        "click_action": "FLUTTER_NOTIFICATION_CLICK",
        "requestId": requestId,
        "customerId": customerId,
      },
      "android": {
        "priority": "high",
        "ttl": 60000,
      },
    };

    await admin.messaging().send(message);
    res.send(true);
    setInterval(async function() {
      const statusInfo = await requestDoc.get();
      if (statusInfo.data().status == "pending") {
        await requestDoc.update({"status": "timed out"});
      }
    }, 60 * 1000);
  } catch (err) {
    return res.send(err);
  }
});


exports.handleCopying = functions.https.onRequest( async (req, res) => {
  // col refers to the term "collection"
  const from = req.query.from;
  const to = req.query.to;
  const docId = req.query.docId;
  // const recursive = req.query.recursive;
  // document reference
  const docRef = admin.firestore().collection(from).doc(docId);
  // copy the document
  const docData = await docRef.get()
      .then((doc) => doc.exists && doc.data())
      .catch((error) => {
        console.error("Error reading document", `${from}/${docId}`,
            JSON.stringify(error));
        throw new functions.https.HttpsError("not-found",
            "Copying document was not read");
      });
  if (docData) {
    // document exists, create the new item
    await admin
        .firestore()
        .collection(to)
        .doc(docId)
        .set({...docData})
        .catch((error) => {
          console.error("Error creating document", `${to}/${docId}`,
              JSON.stringify(error));
          throw new functions.https.HttpsError(
              "data-loss",
              `Data was not copied properly to the target collection,
            please try again.`,
          );
        });

    return res.send(true);
  }
  return res.send(false);
});

exports.onUserStatusChanged = functions.database.ref("/status/{uid}").onUpdate(
    async (change, context) => {
      const eventStatus = change.after.val();


      const userStatusFirestoreRef = db.doc(`status/${context.params.uid}`);

      const statusSnapshot = await change.after.ref.once("value");
      const status = statusSnapshot.val();
      functions.logger.log(status, eventStatus);

      if (status.last_changed > eventStatus.last_changed) {
        return null;
      }

      eventStatus.last_changed = new Date(eventStatus.last_changed);

      return userStatusFirestoreRef.set(eventStatus);
    });

exports.createUser = functions.firestore
    .document("users/{userId}")
    .onCreate((snap, context) => {

    });


