# Push Notifications Setup

Run `Resources/20260723_PUSH_NOTIFICATIONS.sql` in the Supabase SQL editor before enabling push subscriptions.

Set these environment variables in Render for the backend service:

```properties
VAPID_PUBLIC_KEY=<generated-public-key>
VAPID_PRIVATE_KEY=<generated-private-key>
VAPID_SUBJECT=mailto:<your-contact-email>
```

The frontend reads the public key from `GET /push/config`. Do not commit the private key to Git.

After deployment, uninstall any old home-screen shortcut and install the app again from Chrome's install prompt. A normal "Add shortcut" entry opens in Chrome, while an installed PWA opens in its standalone container.
