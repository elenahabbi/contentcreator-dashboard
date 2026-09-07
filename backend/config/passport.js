// backend/config/passport.js
//
// Configures Passport's Google OAuth 2.0 strategy for the "Connect
// YouTube" flow. This is NOT a general login system — the app still has
// no user accounts/sessions of its own (see DEFAULT_USER_ID in
// server.js). The only thing this strategy is used for is obtaining a
// short-lived OAuth access token for the Google account that just
// authorised the app, so server.js can call the YouTube Data API as
// that user and find out which channel belongs to them.
//
// The verify callback below deliberately keeps almost nothing: it hands
// back { accessToken, googleId }. accessToken is used exactly once, in
// the /auth/youtube/callback route, to look up the channel ID — it is
// never persisted to the database and is cleared from the session
// immediately after that lookup (see server.js).

const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const REQUIRED_ENV_VARS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL"];
const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
const isGoogleOAuthConfigured = missingEnvVars.length === 0;

if (isGoogleOAuthConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      (accessToken, refreshToken, profile, done) => {
        // No Google profile fields (name, email, avatar, ...) are stored
        // anywhere — this app has no user-profile UI to show them in.
        // We only keep what's needed to make one authenticated YouTube
        // API call in the callback route right after this.
        return done(null, {
          accessToken,
          googleId: profile && profile.id,
        });
      }
    )
  );
} else {
  // Fail loudly at startup (in the log) rather than mysteriously 500ing
  // the first time someone clicks "Connect YouTube".
  console.warn(
    `[passport] Google OAuth is not configured — missing: ${missingEnvVars.join(", ")}. ` +
      `"Connect YouTube" will not work until these are set in backend/.env (see .env.example).`
  );
}

// Session (de)serialization. The object stored here only ever lives in
// the server-side session store for the few seconds between
// GET /auth/youtube and GET /auth/youtube/callback, and server.js calls
// req.logout() to clear it the moment the callback route is done with
// it — nothing here is meant to represent a "logged in" state.
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

module.exports = { passport, isGoogleOAuthConfigured };