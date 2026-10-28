# Backlog

Things built but not yet checked, or parked for later.

## Test notifications end to end

Notifications are built and deployed (see README, hosting step 6). The GitHub job runs and can reach the database, but no real notification has reached a device yet.

1. Allow home-screen sign-in: console.cloud.google.com → APIs & Services → Credentials → *Web client (auto created by Google Service)* → Authorized redirect URIs → add `https://formula-1-pit-wall.web.app/__/auth/handler` → Save.
2. iPad: Safari → the site → Share → Add to Home Screen → open from the icon → sign in → home page → **Notifications → Turn on for this device**.
3. Mac: open the site in the browser and turn them on the same way.
4. GitHub → Actions → **Notifications** → Run workflow. Each signed-up device should get a test.
5. On a race weekend, check that reminders arrive 25–40 minutes before sessions, and that Safety Car / red flag alerts and results come through.

Until this is done, the job keeps running every 10 minutes but sends nothing, because no device is signed up.
