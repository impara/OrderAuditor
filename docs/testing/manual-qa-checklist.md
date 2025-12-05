## Testing Instructions

### Initial Setup

1. Install the app in your Shopify development store
2. Ensure the app has the following API scopes:
   - `read_orders`
   - `write_orders`
   - `read_customers`
3. Enable Protected Customer Data Access for email, first_name, last_name, and phone (required for duplicate detection)
4. Verify webhooks are registered:
   - Check `GET /api/webhooks/status` endpoint
   - Confirm both `orders/create` and `orders/updated` webhooks are registered
   - Verify in Shopify Admin → Settings → Notifications → Webhooks

### Testing Duplicate Order Detection

5. Create a test order in Shopify with:

   - Customer email: `test@example.com`
   - Customer phone: `+1234567890`
   - Shipping address: `123 Main St, City, 12345`
   - Note the order number

6. Within the configured time window (default 24 hours), create a second order with:

   - Same customer email: `test@example.com`
   - Same or similar shipping address
   - Different order items (optional)

7. Verify duplicate detection:
   - Check the app dashboard for the flagged order
   - Verify the order in Shopify Admin has the `Merge_Review_Candidate` tag
   - Confirm the dashboard shows match reasoning (email match, address match, etc.)

### Testing Dashboard Functionality

8. View flagged orders:

   - Open the app dashboard
   - Verify flagged orders appear in the list
   - Check that customer info, order details, and confidence score are displayed

9. View order details:

   - Click "View Details" on a flagged order
   - Verify the modal shows:
     - Customer information (name, email, phone)
     - Shipping address
     - Order details and line items
     - Duplicate match reasoning
     - Link to Shopify admin

10. Check dashboard stats:
    - Verify stats cards show:
      - Total flagged orders count
      - Potential duplicate value
      - Recent activity metrics

### Testing Settings Configuration

11. Access Settings page:

    - Navigate to Settings in the app
    - Verify default settings are loaded (auto-initialized on first access)

12. Configure detection rules:

    - Adjust time window (e.g., 12 hours, 24 hours, 48 hours)
    - Toggle matching criteria:
      - Enable/disable email matching (50 points)
      - Enable/disable phone matching (50 points)
      - Enable/disable address matching (45 points for full match, 25 for partial)
    - Note: Missing addresses are automatically skipped (no penalty for digital products)
    - Save settings

13. Test with updated settings:
    - Create new test orders with the updated configuration
    - Verify detection behavior matches the new settings

### Testing Order Resolution

14. Manual dismissal:

    - In the dashboard, click "View Details" on a flagged order
    - Click "Dismiss Order"
    - Confirm the dismissal dialog
    - Verify:
      - Order is removed from flagged list
      - `Merge_Review_Candidate` tag is removed from Shopify order
      - Order no longer appears in dashboard

15. Automatic resolution:
    - Flag an order (create a duplicate)
    - In Shopify Admin, manually remove the `Merge_Review_Candidate` tag from the order
    - Wait for the `orders/updated` webhook to process (up to 30 seconds)
    - Verify:
      - Order is automatically removed from flagged list in dashboard
      - Dashboard auto-refreshes to reflect the change

### Testing Edge Cases

16. Test phone number normalization:

    - Create orders with phone numbers in different formats:
      - `+1234567890`
      - `(123) 456-7890`
      - `123-456-7890`
    - Verify orders with same phone (different formats) are detected as duplicates

17. Test address matching:

    - Create orders with:
      - Exact same address (street + city + zip) - should score 45 points
      - Same street + city but different zip - should score 25 points (partial match)
      - Same street + zip but different city - should score 25 points (partial match)
    - Verify detection behavior matches scoring rules

18. Test time window:

    - Create an order
    - Wait until just after the time window expires
    - Create a duplicate order
    - Verify it is not flagged (outside time window)

19. Test missing addresses (digital products/gift orders):
    - Enable address matching in Settings
    - Create an order with email and name, but no shipping address
    - Within the time window, create a second order with:
      - Same email and name
      - No shipping address
    - Verify order IS flagged (Email 50 + Name 20 = 70 points)
    - Note: Missing addresses are automatically skipped, so email + name matching works for digital products

### Testing Email Notifications (Optional)

20. Configure email notifications:

    - In Settings, enable notifications toggle
    - Enter a test email address
    - Set notification threshold (default 80%)
    - Save settings

21. Trigger notification:
    - Create a duplicate order with confidence score above threshold
    - Verify email notification is sent to configured address

### App-Specific Settings to Verify

- Default detection settings are auto-created on first webhook
- Time window: Default 24 hours (configurable)
- Matching criteria: Email, Phone, Address (all enabled by default)
- Scoring: Email 50pts, Phone 50pts, Address 45pts (full) or 25pts (partial), Name 20pts
- Confidence threshold: 70 points (not configurable in UI, but can be verified in detection logic)
- Tag name: `Merge_Review_Candidate` (automatically applied to flagged orders)

### Expected Behaviors

- Orders are flagged when confidence score >= 70 points
- Missing data (addresses, phone numbers) is automatically skipped
- Scoring is transparent: Email 50, Phone 50, Address 45/25, Name 20
- Dashboard auto-refreshes every 30 seconds
- Settings are persisted and applied to all new orders
- Both manual and automatic resolution methods work correctly
- Webhooks process within seconds of order creation/update

These instructions cover the main workflows. The app should work with default settings, but testing with custom configurations verifies flexibility.
