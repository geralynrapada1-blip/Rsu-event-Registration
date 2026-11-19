# RSU-Cajidiocan School Event Registration System

## Included
Student registration/login, organizer login, event CRUD, announcement CRUD, registration management, student account activation/deactivation, in-app notifications, optional Gmail email, MongoDB persistence, mobile-friendly pages.

## Local setup
1. Extract this ZIP and open the `rsu-event-registration` folder in VS Code.
2. Open Terminal and run `npm install`.
3. Copy `.env.example` to a new file named `.env`.
4. Fill in `MONGODB_URI`, `SESSION_SECRET`, and organizer credentials. Optional email settings: `EMAIL_USER` and a Google App Password in `EMAIL_PASS`.
5. Run `npm start`, then open `http://localhost:3000`.

MongoDB Atlas: create a cluster, create a database user, and copy the Node.js connection string. Keep the database password private. Configure Atlas Network Access for local testing and the deployed service as appropriate.

## Organizer account
On first server start, an organizer is created from `ORGANIZER_EMAIL` and `ORGANIZER_PASSWORD` in `.env`. Keep these credentials private. Public sign-up creates student accounts only.

## GitHub
Create an empty repository on GitHub. In the VS Code terminal, from this project folder, run:
```bash
git init
git add .
git commit -m "Initial RSU event registration system"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/rsu-event-registration.git
git push -u origin main
```
Replace the URL with your own repository URL. `.env` is ignored; do not upload it.

## Render
1. In Render choose New + > Web Service, connect GitHub, and select your repository.
2. Build command: `npm install`; Start command: `npm start`.
3. Add environment variables in Render: `MONGODB_URI`, `SESSION_SECRET`, `BASE_URL` (the root URL such as `https://your-app.onrender.com`), `ORGANIZER_NAME`, `ORGANIZER_EMAIL`, `ORGANIZER_PASSWORD`, `EMAIL_USER`, `EMAIL_PASS`, and optionally `EMAIL_FROM`.
4. Save and deploy. Visit `/api/health`; expect `status: ok` and `database: connected`.
5. Test student and organizer functions again on the Render URL.

After code changes:
```bash
git add .
git commit -m "Describe your change"
git push
```
Render can automatically redeploy after each push.

## Demo checklist
- Organizer creates, edits, and deletes a sample event.
- Student views the event and registers.
- Organizer reviews registrations and changes pending to approved or attended.
- Student sees updated status and in-app notification.
- Organizer creates, edits, and deletes an announcement.
- Test account activation/deactivation.
- Check email inbox if Gmail settings are configured.

Email messages can be read using Gmail on a phone; they are not native push notifications. This is a starter school project: test all workflows with sample data before presentation and have the school review privacy and security before real deployment.


## Email and mobile push notifications

### Email notifications
Set `EMAIL_USER`, `EMAIL_PASS` (Gmail App Password), and `EMAIL_FROM` in `.env`. Students receive email at the address they entered when registering. Check the server terminal for `EMAIL SENT` or `EMAIL SEND FAILED`.

### Mobile push notifications
Push notifications require a browser that supports Web Push and permission from each student. Each student must sign in on their phone, open Student Dashboard, and tap **Enable Mobile Push Notifications** once. The browser will ask for permission. A new account cannot receive push alerts until the student has enabled notifications on that device.

Generate VAPID keys after `npm install`:

```bash
npx web-push generate-vapid-keys
```

Copy the generated public and private keys into `.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Set `VAPID_SUBJECT` to a mailto address. Keep the private key secret and never upload `.env` to GitHub. Restart with `npm start`.

For local testing, open the site at `http://localhost:3000` (localhost is treated as a secure context by modern browsers). On Render, use the HTTPS site URL. On iPhone/iPad, web push generally requires the website to be added to the Home Screen and opened as a web app; Android Chrome can enable push from the browser.

Announcements and newly created events send push alerts to students who enabled push on their devices. Registration status changes also send a push alert to the affected student. Email delivery is separate and depends on correct Gmail configuration.
