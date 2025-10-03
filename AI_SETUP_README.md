# AI-Powered Lead Verification Setup

This guide explains how to set up ChatGPT and Claude AI integration for enhanced lead verification.

## Features

- **Dual AI Verification**: Use ChatGPT, Claude, or both simultaneously for lead verification
- **Automatic Owner Name Detection**: AI identifies and verifies business owner/contact names
- **Business Details Enrichment**: Get detailed business information including:
  - Industry classification
  - Employee count estimates
  - Revenue estimates
  - Business insights
- **Confidence Scoring**: Each verification includes a confidence score (0-100)
- **Flexible AI Selection**: Choose which AI provider to use per verification

## Setup Instructions

### 1. Get API Keys

#### OpenAI (ChatGPT) API Key
1. Go to https://platform.openai.com/
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key (starts with `sk-...`)

#### Anthropic (Claude) API Key
1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key (starts with `sk-ant-...`)

### 2. Configure API Keys

Open `lead-scraper-backend/.env` file and replace the placeholder values:

```env
# Replace these with your actual API keys
OPENAI_API_KEY=sk-your-actual-openai-key-here
ANTHROPIC_API_KEY=sk-ant-your-actual-anthropic-key-here
```

**Important Notes:**
- You can configure just one AI provider or both
- The system will work with mock data if no APIs are configured
- Keep your API keys secure and never commit them to version control

### 3. Restart the Backend Server

After updating the `.env` file, restart the backend server:

```bash
cd lead-scraper-backend
npm start
```

## How It Works

### AI Verification Process

When you click "Verify & Add" on a scraped lead:

1. **Data Collection**: The system gathers lead information (company name, phone, address, industry)
2. **AI Analysis**: Selected AI provider(s) analyze the business and provide:
   - Verified owner/contact name
   - Industry classification
   - Employee count range
   - Revenue estimates
   - Business details
   - Confidence score
3. **Result Combination**: If using both AIs, results are combined for higher accuracy
4. **Enhanced Lead**: The enriched lead is added to your verified leads list

### API Provider Selection

The system supports three modes:

- **`both`** (default): Uses both ChatGPT and Claude, combines results
- **`chatgpt`**: Uses only OpenAI's ChatGPT
- **`claude`**: Uses only Anthropic's Claude

### API Endpoints

#### Check AI Status
```bash
GET http://localhost:5000/api/ai-status
```

Returns the configuration status of both AI providers.

#### Verify Lead
```bash
POST http://localhost:5000/api/verify
Content-Type: application/json

{
  "lead": {
    "companyName": "Example Corp",
    "phone": "+1-555-123-4567",
    "address": "123 Main St, City, State",
    "industry": "Technology"
  },
  "aiProvider": "both"  // optional: "both", "chatgpt", or "claude"
}
```

## Cost Considerations

### OpenAI (ChatGPT) Pricing
- Model used: GPT-3.5-turbo
- Approximate cost: $0.001-0.002 per lead verification
- Very affordable for most use cases

### Anthropic (Claude) Pricing
- Model used: Claude 3.5 Sonnet
- Approximate cost: $0.003-0.004 per lead verification
- Slightly higher but provides detailed analysis

### Recommendations
- Start with one AI provider to test
- Use `both` mode for critical leads requiring highest accuracy
- Monitor your API usage in respective dashboards

## Example Verification Result

```json
{
  "id": 1234567890,
  "companyName": "Tech Solutions Pro",
  "phone": "+1-555-123-4567",
  "address": "123 Tech Street, San Francisco, CA 94103",
  "industry": "Technology",
  "ownerName": "Sarah Johnson",
  "employeeCount": "50-100",
  "revenue": "$5M - $10M",
  "businessDetails": "B2B SaaS company specializing in cloud solutions",
  "aiConfidence": 92,
  "aiSource": "ChatGPT + Claude (Combined)",
  "chatGPTConfidence": 90,
  "claudeConfidence": 94,
  "verified": true,
  "socialMedia": {
    "linkedin": "linkedin.com/company/tech-solutions-pro",
    "facebook": "facebook.com/techsolutionspro"
  }
}
```

## Troubleshooting

### API Key Not Working
- Ensure no extra spaces in the `.env` file
- Verify the key is valid in the respective platform
- Check your API credit balance

### Rate Limiting
- OpenAI: 3 requests per minute (free tier)
- Anthropic: Check your plan limits
- The app includes built-in rate limiting to prevent issues

### Mock Data Being Used
If you see "Mock verification" in results:
- Check that API keys are correctly set in `.env`
- Ensure keys don't match the placeholder text
- Restart the backend server after updating `.env`

## Security Best Practices

1. **Never commit** `.env` file to version control
2. **Rotate API keys** periodically
3. **Monitor API usage** to detect anomalies
4. **Set spending limits** in AI provider dashboards
5. **Use environment variables** in production

## Support

For issues related to:
- **OpenAI API**: https://help.openai.com/
- **Anthropic API**: https://support.anthropic.com/
- **This Application**: Check the main README.md

## Future Enhancements

Planned features:
- Batch verification for multiple leads
- Custom AI prompts
- Additional AI providers (Google Gemini, etc.)
- Verification history and analytics
- Lead quality scoring

---

**Note**: AI-generated information should be verified through additional sources for critical business decisions. The AI provides estimates and insights based on available data patterns.
