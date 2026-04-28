# Care AI Vision

A [CARE](https://github.com/ohcnetwork/care_fe) App (plugin) that leverages OCR to capture patient registration details from scanned or photographed forms and automatically populate the details in CARE registration.

## Features

- 📷 **Scan or upload** — pick an image from camera, gallery, or file picker
- 🤖 **AI-powered extraction** — uses Gemini Flash to extract structured patient data from form images
- 🏛️ **Governance resolution** — automatically resolves State → District → Local Body → Ward hierarchy via Care's Organization API
- ✅ **Auto-fills form fields** — name, phone, gender, DOB/age, blood group, address, pincode, and governance location
- 🔁 **Retry on failure** — reprocesses the same image without re-upload


## Getting Started

### Prerequisites

- A running [Care frontend](https://github.com/ohcnetwork/care_fe) instance to host this plugin

### Installation

```bash
git clone https://github.com/ohcnetwork/care_ai_vision.git
cd care_ai_vision
npm install
```

### Configuration

Create a `.env.local` file:

```env
REACT_APP_GEMINI_API_KEY=your_gemini_api_key_here
```

You can obtain a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

> The plugin also supports receiving the API key via `__meta.config.REACT_APP_GEMINI_API_KEY` from the host Care app.

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
3. Image is sent to Gemini Flash API for structured data extraction
4. Extracted fields are validated and auto-filled into the form
5. Governance hierarchy (state/district/local body/ward) is resolved via Care's Organization API
6. User reviews extracted data and confirms
