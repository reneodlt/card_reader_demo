# Chrome Web Store Publishing Todo

## Developer Account Setup
- [ ] Register at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
- [ ] Enable 2-Step Verification on Google account
- [ ] Pay one-time $5 USD registration fee

## Required Assets
- [x] Extension icons at 16/48/128px (`icons/`)
- [ ] Promotional tile (440x280 px, PNG or JPEG)
- [ ] At least 1 screenshot (1280x800 px)
- [x] Store description (see `store/description.txt`)

## Privacy & Compliance
- [x] Privacy policy written (see `PRIVACY_POLICY.md`)
- [ ] Host privacy policy at a public HTTPS URL (e.g. GitHub Pages, or link to the raw file on GitHub)
- [x] Permission justifications prepared (see `store/description.txt`):
  - `storage` — stores user preferences (endpoint URL, venue ID, detection mode)
  - `alarms` — keeps the service worker alive to maintain smart card reader connection

## Package & Submit
- [ ] Test extension as unpacked from a fresh `.zip` to catch missing files
- [ ] Verify all file paths in `manifest.json` are case-correct
- [ ] Upload `.zip` to Developer Dashboard → Add new item
- [ ] Fill in store listing with description, category, screenshots, privacy policy URL
- [ ] Fill in Privacy Practices tab with permission justifications
- [ ] Choose distribution: Public / Unlisted / Private
- [ ] Submit for review (expect 1–3 business days for this permission profile)

## Post-Publish
- [ ] Note the published extension's fixed Chrome Web Store ID
- [ ] Test that Smart Card Connector prompts users to allow the extension
- [ ] Consider requesting addition to Smart Card Connector's built-in allowlist via [GoogleChromeLabs/chromeos_smart_card_connector](https://github.com/GoogleChromeLabs/chromeos_smart_card_connector)
- [ ] For enterprise: document the `force_allowed_client_app_ids` Chrome policy for admins

## Reference Links
- [Register developer account](https://developer.chrome.com/docs/webstore/register)
- [Publish to Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
- [Image requirements](https://developer.chrome.com/docs/webstore/images)
- [Review process](https://developer.chrome.com/docs/webstore/review-process)
- [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- [Privacy policy requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy)
