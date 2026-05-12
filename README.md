# Care AI Vision

AI-powered [CARE](https://github.com/ohcnetwork/care_fe) App (plugin) to extract and auto-fill patient registration details from scanned or photographed forms.

## Features

- 📷 **Scan or upload** — pick an image from camera, gallery, or file picker
- 🤖 **AI-powered extraction** — uses Care AI backend to extract structured patient data from form images
- 🏛️ **Governance resolution** — automatically resolves State → District → Local Body → Ward hierarchy via Care's Organization API
- ✅ **Auto-fills form fields** — name, phone, gender, DOB/age, blood group, address, pincode, and governance location
- 🔁 **Retry on failure** — reprocesses the same image without re-upload


## Getting Started

### Prerequisites

- A running [Care frontend](https://github.com/ohcnetwork/care_fe) instance to host this plugin
- A running [Care backend](https://github.com/ohcnetwork/care) with [care_ai plugin](https://github.com/ohcnetwork/care_ai) installed

### Installation

```bash
git clone https://github.com/ohcnetwork/care_ai_vision.git
cd care_ai_vision
npm install
```

### Configuration

No additional configuration needed! The plugin uses the Care AI backend which is configured at the server level.

> The Care AI backend handles all AI provider credentials (Gemini, OpenAI, Azure, etc.) securely on the server side.

### Development

```bash
npm start
```

This starts the dev server on port **10120** with hot reload.

### Production Build

```bash
npm run build
```

## How It Works

1. User clicks "Scan Registration Form" on the patient registration page
2. Browser shows native image picker (camera / gallery / files)
3. Image is sent to Care AI backend (`/api/care_ai/ask/`) for structured data extraction
4. Care AI backend processes the request using configured AI provider (Gemini, OpenAI, etc.)
5. Extracted fields are validated and auto-filled into the form
6. Governance hierarchy (state/district/local body/ward) is resolved via Care's Organization API
7. User reviews extracted data and confirms

