# WhatsApp integration

The chatbot registers complaints over the WhatsApp Business Cloud API. The same code runs in two modes:

| `WHATSAPP_DRIVER` | Use | Replies go to |
| --- | --- | --- |
| `mock` (default) | Development, testing, demos | In-memory store, shown on the **WhatsApp simulator** page |
| `cloud` | Production | Real WhatsApp users, through Meta's Graph API |

## Trying it without Meta

Leave `WHATSAPP_DRIVER=mock`. Sign in as an administrator or Quality Coordinator, open **WhatsApp simulator**, and type `Hi`.

Each message is turned into the payload Meta sends and passed through the real webhook processing, so the simulator exercises the code that runs in production:
- duplicate protection and validation;
- media checks;
- the notification queue.

## Conversation

1. `Hi` starts (or restarts at any point). `cancel` stops.
2. Full name.
3. Email address, validated; an invalid address is asked again.
4. Customer, Retailer or Distributor (buttons).
5. Business unit (list, from `WHATSAPP_SBUS`).
6. Country.
7. Where the product was bought (customer), or the business name (retailer or distributor).
8. Product (optional).
9. Batch number (optional).
10. Problem type (list, from `WHATSAPP_CATEGORIES`).
11. Short description.
12. Up to 5 photos or documents, and any extra notes, then **Done**.
13. Summary, then **Submit** or **Start over**.

The mobile number comes from the WhatsApp sender, so it is never typed. A sender's progress is kept for 24 hours of inactivity.

On **Submit**:
- The complaint is created with origin **WhatsApp** and goes straight to "Acknowledgement pending" like any other complaint.
- Photos are downloaded from Meta and checked like normal uploads, and attached as "Synced files".
- The complaint number is sent back through the notification queue, so it is retried if WhatsApp is briefly unavailable.

When the complaint is acknowledged in D1, the reporter also gets a short WhatsApp status message, as well as the acknowledgement email.

## Reliability and security

- **Signature check:** every webhook call must carry a valid `X-Hub-Signature-256` HMAC of the raw body, made with the app secret. Unsigned or altered requests get `401` and are not stored.
- **Duplicates:** Meta redelivers webhooks. Each message id is stored once (unique index), and redeliveries are skipped.
- **Double taps:** a double-tapped **Submit** creates one complaint, because the session is claimed atomically.
- **Failed replies:** if a chat reply fails, it is logged as failed. The conversation state and any complaint are still saved, so a WhatsApp outage never corrupts complaint records.
- **Delivery receipts:** `delivered` and `read` mark the notification **Delivered**; `failed` marks it **Failed** with Meta's reason.

## Connecting the real WhatsApp Business account

You need a Meta Business account, a WhatsApp Business app in the Meta developer console, a verified phone number, and a permanent system-user access token with `whatsapp_business_messaging` permission.

1. Choose a long random verify token, for example with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
2. In `server/.env` set:
   ```
   WHATSAPP_DRIVER=cloud
   WHATSAPP_VERIFY_TOKEN=<the token from step 1>
   WHATSAPP_APP_SECRET=<App settings → Basic → App secret>
   WHATSAPP_ACCESS_TOKEN=<system-user token>
   WHATSAPP_PHONE_NUMBER_ID=<WhatsApp → API setup → Phone number ID>
   ```
   The server refuses to start in `cloud` mode if any of these is missing.
3. Deploy the API on HTTPS. In the Meta app go to **WhatsApp → Configuration → Webhook**, set the callback URL to `https://<your-domain>/api/webhooks/whatsapp`, enter the same verify token and save. Meta calls the URL, and the server answers the challenge only if the token matches.
4. Subscribe the webhook to the **messages** field.
5. Send `Hi` to the business number from a phone.

## Limits to know

- **24-hour window:** WhatsApp allows free-form replies only within 24 hours of the customer's last message. The registration reply always falls inside it. A status update sent later, such as acknowledgement after a weekend, needs a **message template** approved by Meta. Template approval takes time, so request it early (Q14). Until a template exists, late status updates will fail and show as **Failed** in Notification logs, while email still carries the acknowledgement.
- **Lists:** WhatsApp lists hold at most 10 rows and buttons hold at most 3, so keep `WHATSAPP_SBUS` and `WHATSAPP_CATEGORIES` to 10 entries or fewer.
