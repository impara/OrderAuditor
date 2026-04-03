# Review Prompt Smoke Test

## Goal

Verify that the lightweight review prompt renders correctly in production, opens the external Shopify App Store review modal URL, routes negative feedback into support, and does not break the embedded app flow.

## Preconditions

1. Deploy the current application code.
2. Run the production schema sync:

```bash
sudo docker compose -f docker-compose.prod.yml exec app_blue \
  npx drizzle-kit push
```

Without the new `subscriptions` review-prompt fields, prompt actions cannot persist correctly.

## Smoke Test

### 1. Verify preview rendering on a real embedded shop

Open the production app with:

```text
https://your-app-url/?testReviewPrompt=true
```

Expected:

- The review banner appears at the top of the dashboard.
- It starts on the first question.
- The rest of the dashboard continues to load normally.

### 2. Verify the positive branch

Click `Yes, it’s helpful`.

Expected:

- The banner switches to the review CTA state.
- Clicking `Leave a review` opens the external Shopify App Store URL in a new tab:

```text
https://apps.shopify.com/duplicate-guard#modal-show=ReviewListingModal
```

- The embedded app itself does not navigate away or break.

### 3. Verify the negative branch and support flow

Reload the same preview URL:

```text
https://your-app-url/?testReviewPrompt=true
```

Click `Not quite yet`, then click `Share feedback`.

Expected:

- The app navigates to `/support` inside the embedded app.
- The support page shows the review-feedback helper copy.
- The subject is prefilled as `Feedback about Duplicate Guard`.
- Submitting the form includes review metadata in the support email context.

### 4. Verify normal non-preview behavior

Open the app again without the preview query param.

Expected:

- The prompt only appears if the shop is genuinely eligible.
- If the shop is not eligible, the banner is absent.
- No console errors appear.
- No failing `/api/review-prompt` requests appear in the network tab.

### 5. Verify the review prompt API response shape

In the browser network tab, inspect the `GET /api/review-prompt` request.

Expected:

- Response status is `200`.
- Response includes:
  - `showPrompt`
  - `response`
  - `cooldownEndsAt`
  - `supportUrl`
  - `promptVersion`

## Important Note

With `?testReviewPrompt=true`, preview mode is intentionally UI-only for actions like dismiss and defer. It is meant for smoke testing the flow, not for persisting test state to the shop.
