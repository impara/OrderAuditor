# Duplicate Guard - Design Guidelines

## Design Approach
**Selected System:** Shopify Polaris Design System
**Rationale:** This is an admin-focused Shopify app where efficiency, data clarity, and consistency with Shopify's ecosystem are paramount. Polaris provides battle-tested patterns for merchant-facing tools.

## Core Design Principles
1. **Data-First Clarity:** Prioritize scannable information hierarchies
2. **Merchant Efficiency:** Minimize clicks, maximize actionable insights
3. **Shopify Consistency:** Align with familiar admin patterns merchants know

## Typography
- **Primary Font:** Inter (Shopify Polaris standard)
- **Hierarchy:**
  - Page Titles: 20px/semibold
  - Section Headers: 16px/semibold  
  - Body Text: 14px/regular
  - Data Labels: 12px/medium
  - Stats/Metrics: 24px/bold for numbers, 12px/regular for labels

## Layout System
**Spacing Primitives:** Polaris spacing scale (4px base unit)
- Container padding: 16px (mobile), 20px (desktop)
- Section spacing: 16px between cards
- Component internal spacing: 12px, 16px
- Tight data rows: 8px vertical padding

## Component Library

### Dashboard Layout
**Two-Column Grid:**
- Left column (2/3 width): Flagged orders data table
- Right column (1/3 width): Stats cards stacked vertically

**Stats Cards (4 total):**
1. Total Flagged Orders (with 7-day trend indicator)
2. Potential Duplicate Value (dollar amount)
3. Orders Flagged Today
4. Average Resolution Time
- Each card: White background, 12px padding, subtle border, icon + metric + label layout

### Flagged Orders Table
**Columns:**
1. Order Number (linked, bold)
2. Customer Name + Email (stacked, with avatar)
3. Duplicate Match Reason (badge with severity color)
4. Order Total
5. Date Flagged
6. Actions (View Details button)

**Table Features:**
- Sortable columns
- Checkbox for bulk actions
- Row hover state with slight background tint
- Status badges using Polaris color tokens (critical/warning)

### Settings Page
**Tabbed Interface:**
- Detection Rules tab
- Notifications tab

**Detection Rules Section:**
- Form layout with clear labels above inputs
- Time window slider (1-72 hours) with live value display
- Checkbox group for matching criteria (email, phone, address)
- Address matching sensitivity toggle

**Notifications Section:**
- Email notification toggle
- Slack webhook URL input
- Notification threshold selector

### Navigation
**Top App Bar:**
- App name/logo (left)
- Primary nav tabs: Dashboard | Settings
- User account menu (right)

## Visual Hierarchy
**Priority Levels:**
1. Critical alerts/flagged items: Red/critical badges
2. Primary actions: Polaris primary button (green)
3. Secondary data: Subdued text color
4. Metadata: Extra small, light gray text

## Data Visualization
**Match Confidence Indicators:**
- High confidence (90%+): Critical badge, red
- Medium confidence (70-89%): Warning badge, yellow
- Low confidence (<70%): Attention badge, gray

**Trend Indicators:**
- Up/down arrows with percentage change
- Color-coded: Green (down is good), red (up needs attention)

## Responsive Behavior
- **Desktop (1024px+):** Full two-column dashboard layout
- **Tablet (768-1023px):** Stats cards in 2x2 grid above table
- **Mobile (<768px):** Single column, cards stack, table scrolls horizontally

## Interaction Patterns
- **Order Details:** Modal overlay with full order info, duplicate comparison, and review actions (Mark as duplicate, Mark as unique)
- **Bulk Actions:** Select multiple orders → toolbar appears with batch review options
- **Loading States:** Polaris skeleton screens for tables, spinner for actions

## Empty States
**No Flagged Orders:**
- Centered illustration (simple Shopify-style line art)
- Headline: "No duplicate orders detected"
- Subtext: "Your detection rules are running. We'll notify you when duplicates are found."
- Secondary action: "Adjust Detection Settings" button

## Performance Indicators
- Real-time webhook status indicator (green dot = active)
- Last sync timestamp in page header
- Processing queue count if orders are pending review