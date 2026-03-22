const admin = require('firebase-admin');

// Service account is passed via environment variable from GitHub Secrets
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT;
// Required for Realtime Database access
const databaseURL = process.env.FIREBASE_DB_URL; 

if (!serviceAccountKey || !databaseURL) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_DB_URL secret. Exiting.");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountKey);
} catch (e) {
  console.error("Invalid JSON inside FIREBASE_SERVICE_ACCOUNT secret.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: databaseURL
});

async function run() {
  try {
    console.log("Fetching registered devices from Firebase DB...");
    const db = admin.database();
    
    // Read the /tokens node directly
    const snapshot = await db.ref('tokens').once('value');
    const tokensObj = snapshot.val();
    
    if (!tokensObj) {
      console.log("No devices registered for push notifications yet.");
      return;
    }

    // Extract the raw tokens into an array
    const tokens = Object.values(tokensObj).map(d => d.token).filter(Boolean);
    if (tokens.length === 0) {
      console.log("No valid device tokens found.");
      return;
    }

    console.log(`Found ${tokens.length} registered devices. Sending push notifications...`);

    // Standard Web Push FCM Payload
    const message = {
      notification: {
        title: 'Track Your Habits! 🎯',
        body: 'Take 10 seconds to log today’s progress, todos, and expenses in MyTrack.'
      },
      webpush: {
        notification: {
          icon: 'icon-192.png',
          click_action: 'https://mobid.github.io/MyTrack/'
        }
      },
      tokens: tokens, // Send to all tokens at once (multicast)
    };

    const response = await admin.messaging().sendMulticast(message);
    console.log(`Push Results: ${response.successCount} sent successfully | ${response.failureCount} failed.`);
    
    // Optional: We could parse response.responses to remove dead tokens from DB
  } catch (err) {
    console.error("Fatal Error sending push message:", err);
    process.exit(1);
  }
}

run();
