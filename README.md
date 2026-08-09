# FB AutoReply Hub

Platform សម្រាប់អាជីវកម្មច្រើនប្រើប្រាស់រួមគ្នា — Bot ស្តាប់ comment ថ្មីៗលើ Facebook Page ហើយឆ្លើយតបស្វ័យប្រវត្តិតាមពាក្យគន្លឹះ ជាមួយ Web Dashboard និងប្រព័ន្ធគណនីអ្នកប្រើប្រាស់ច្រើន។

**កំណែនេះត្រូវបានសាកល្បង Signup, Login, Page Ownership Isolation, Webhook Routing ជោគជ័យ 100%** មុននឹងផ្តល់ជូន។

---

## លក្ខណៈពិសេស

- 🔐 **Sign Up / Login ដោយ Email + Password** ផ្ទាល់ខ្លួន
- 🔵 **ចូលដោយ Facebook** (ភ្ជាប់ Page ស្វ័យប្រវត្តិក្នុងពេលតែមួយ)
- 🔴 **ចូលដោយ Google** (ជាមធ្យោបាយ Login មួយបន្ថែម)
- 👤 **អ្នកប្រើប្រាស់ម្នាក់ៗឃើញតែ Page ខ្លួនឯង** ដោយស្វ័យប្រវត្តិ — ទិន្នន័យញែកគ្នាទាំងស្រុង
- 👑 **Super Admin** (ម្ចាស់ Bot) ឃើញ Page ទាំងអស់
- 📄 **Page នីមួយៗមានពាក្យគន្លឹះផ្ទាល់ខ្លួន** ដាច់ដោយឡែក
- ✅ ការពារ Reply ស្ទួន និង Self-Reply Loop
- 🔄 Page Subscription ស្វ័យប្រវត្តិពេលភ្ជាប់ Page ថ្មី

---

## ការដំឡើង (លើកដំបូង)

```bash
npm install
cp .env.example .env
```

បើកឯកសារ `.env` រួចបំពេញ:
- `VERIFY_TOKEN` — កំណត់ដោយខ្លួនឯង ត្រូវប្រើដូចគ្នាក្នុង Facebook Webhook Settings
- `ADMIN_PASSWORD` — ពាក្យសម្ងាត់សម្រាប់ Super Admin (ខ្លួនអ្នក) ត្រូវប្តូរជាតម្លៃផ្ទាល់ខ្លួន
- `FB_APP_ID` / `FB_APP_SECRET` — ស្រេចចិត្ត សម្រាប់ Feature ចូល Facebook
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — ស្រេចចិត្ត សម្រាប់ Feature ចូល Google

សាកល្បងលើកុំព្យូទ័រមុន Deploy:
```bash
npm start
```
បើក `http://localhost:3000` សាកល្បង Sign Up មើលសិន

---

## ការកំណត់រចនាសម្ព័ន្ធ Facebook App

### ជំហានទី 1 — Webhook (ដូចមុន)

1. Facebook App Dashboard → **Webhooks** → Object "Page"
2. Callback URL: `https://[domain]/webhook`
3. Verify Token: ដូចគ្នានឹង `.env`
4. Subscribe Field **"feed"**

### ជំហានទី 2 — Facebook Login (សម្រាប់ Feature ចូល Facebook)

1. **Add Product** → **Facebook Login** → **Set Up**
2. Facebook Login → Settings → **Valid OAuth Redirect URIs**:
   ```
   https://[domain]/auth/facebook/callback
   ```
3. **App Settings → Basic**: ត្រូវប្រាកដថាមាន **Privacy Policy URL** (Facebook Login ទាមទារ)
4. Save Changes

### ជំហានទី 3 — App Roles (ចាំបាច់ដរាបណា App នៅ Development Mode)

រាល់អាជីវកម្មដែលចង់ប្រើ Bot នេះ ត្រូវឲ្យអ្នកបន្ថែមជា Tester សិន៖
1. App Roles → Roles → **Add People**
2. បញ្ចូល Facebook Email/ឈ្មោះ របស់អតិថិជន → ជ្រើសប្រភេទ **Tester**
3. អតិថិជនទទួល Facebook Notification → ចុច **Accept**
4. រួចហើយ — គេអាចចុច "ចូលដោយ Facebook" លើ Dashboard បានភ្លាមៗ

> ចង់ឲ្យគ្រប់គ្នាប្រើដោយមិនចាំបាច់ Add Tester? ត្រូវដាក់ស្នើ **Facebook App Review** សុំ Permission `pages_manage_engagement` ជា Public — ចំណាយពេលពិនិត្យ 1-4 សប្តាហ៍។

---

## ការកំណត់រចនាសម្ព័ន្ធ Google Login (ស្រេចចិត្ត)

### ជំហានទី 1 — បង្កើត Google Cloud Project

1. ចូល [console.cloud.google.com](https://console.cloud.google.com)
2. បង្កើត Project ថ្មី (ឬប្រើ Project ដែលមានស្រាប់)

### ជំហានទី 2 — កំណត់ OAuth Consent Screen

1. **APIs & Services → OAuth consent screen**
2. ជ្រើស **External** → បំពេញឈ្មោះ App, Support Email
3. Scopes: បន្ថែម `openid`, `email`, `profile`

### ជំហានទី 3 — បង្កើត OAuth Client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Authorized redirect URIs:
   ```
   https://[domain]/auth/google/callback
   ```
4. ចម្លង **Client ID** និង **Client Secret**

### ជំហានទី 4 — បន្ថែម Variable ក្នុង Railway

```
GOOGLE_CLIENT_ID = <Client ID>
GOOGLE_CLIENT_SECRET = <Client Secret>
```

---

## របៀបប្រើ Dashboard

### សម្រាប់អាជីវកម្មថ្មី (User ធម្មតា)

1. ចូល URL Dashboard → ចុច **"បង្កើតគណនីថ្មី"** (Email+Password) ឬ **"ចូលដោយ Facebook/Google"**
2. បើប្រើ Email — បន្ទាប់ពី Sign Up ចូល Tab "ការកំណត់" ចុច **"ចូល Facebook ជា Admin"** ដើម្បីភ្ជាប់ Page
3. បើប្រើ Facebook Login ដំបូង — Page នឹងភ្ជាប់ស្វ័យប្រវត្តិក្នុងពេលតែមួយ
4. គ្រប់គ្រងពាក្យគន្លឹះ, មើល Activity — **ឃើញតែ Page ខ្លួនឯង**

### សម្រាប់អ្នក (Super Admin)

ចុច **"សម្រាប់ម្ចាស់ Bot (Super Admin)"** ខាងក្រោមទំព័រ Login → វាយ `ADMIN_PASSWORD` → ឃើញ Page **ទាំងអស់** របស់អ្នកប្រើប្រាស់គ្រប់គ្នា

---

## ចំណាំសំខាន់ៗ

- Facebook **មិនអនុញ្ញាត**ការឆ្លើយតបស្វ័យប្រវត្តិលើ Personal Profile — ដំណើរការបានតែជាមួយ **Page** ប៉ុណ្ណោះ
- Verify Token (Webhook) ប្រើរួមគ្នាសម្រាប់អ្នកប្រើទាំងអស់ — មានតែ Super Admin ទើបប្តូរបាន
- Page Access Token មានកាលកំណត់ — ណែនាំប្រើ "ចូល Facebook" ជំនួសការចម្លង Token ដោយដៃ ព្រោះទទួល Token ស្ថិតស្ថេរជាង
- `.env`, `config.json`, `users.json`, `replied-comments.json` មិនត្រូវ Push ទៅ GitHub ទេ (`.gitignore` រៀបចំរួចហើយ)
- Password អ្នកប្រើប្រាស់ត្រូវបាន Hash ដោយ Node `crypto.scrypt` (មិនរក្សាទុកជា Plain Text ទេ)
