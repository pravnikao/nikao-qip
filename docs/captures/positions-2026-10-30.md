# Capture: Positions · 2026-10-30 · demo

**Route:** `/positions` (http://localhost:4310/positions) · **Heading:** `Positions` (h1) · **Page title:** `Positions · Demo Holdings` · **Tenant on screen:** `Alpha Capital` (tenant-switcher value `alpha`) · **Signed in as:** `admin` (shown in header, `data-qa="user-name"`)

**Demo mode:** `window.DEMO_DEFECTS === false`

**Sign-in:** fresh login in the isolated Playwright MCP browser (`admin` / bundled demo password). Unauthenticated `/positions` redirected to `/auth/realms/demo/login?next=%2Fpositions` (heading `Sign in to Demo Holdings`, fields `Username`, `Password`, button `Sign in`).

**Tenant:** the fresh login landed on **Beta Partners** (`beta`). I switched to **Alpha Capital** with the header switcher ("Acting for") and confirmed `Alpha Capital` selected on screen. Tenant options: `alpha` = Alpha Capital, `beta` = Beta Partners. Switching reloads the whole page (navigation type `reload`). The tenant is held in a cookie named `qip_demo_tenant` (name only; value not recorded). No tenant query parameter or tenant header is sent on API calls.

## Hooks (data-qa)
155 `[data-qa]` elements with 20 rows rendered: 15 static hooks + 20 rows x (1 row + 6 cells).

| Group | data-qa | Element / text |
| --- | --- | --- |
| Header | `app-header` | `<header>`: "Demo Holdings", nav `Positions · Documents · Comments`, "Acting for" |
| Header | `tenant-switcher` | `<select>` labelled "Acting for"; options `Alpha Capital`, `Beta Partners` |
| Header | `user-name` | `<span>` "admin" |
| Filters | `positions-search-input` | `<input type="text">`, placeholder `Issuer or ISIN`, not inside a `<form>` |
| Filters | `positions-from` | `<input type="date">`, label `From` |
| Filters | `positions-to` | `<input type="date">`, label `To` |
| Filters | `positions-sort` | `<select>` with no label; options `issuer`=Issuer (default), `quantity`=Quantity, `tradeDate`=Trade date |
| Filters | `positions-search-button` | `<button>` "Search" |
| Filters | `positions-export-button` | `<button>` "Export CSV" (not clicked, out of scope) |
| Grid | `positions-table` | `<table>`; column headers `ISIN`, `Issuer`, `Quantity`, `Market value`, `Trade date`, `Status` (no hooks on `<th>`) |
| Grid | `positions-empty` | `<div>` "No positions match your search."; always in the DOM, `hidden` while rows exist |
| Row pattern | `positions-row-<id>` | `<tr>`, `<id>` = API `items[].id` (for example `positions-row-1019`) |
| Cell pattern | `positions-cell-<field>-<id>` | `<td>`, `<field>` is one of `isin`, `issuer`, `quantity`, `marketValue`, `tradeDate`, `status` (for example `positions-cell-marketValue-1019`) |
| Dialogs | none | No dialogs on this screen |
| Pagination | `positions-page-prev` | `<button>` "Previous" (disabled on page 1) |
| Pagination | `positions-page-summary` | `<span>` "Page N of M · T positions" |
| Pagination | `positions-page-next` | `<button>` "Next" (disabled on last page) |
| Pagination | `positions-page-size` | `<select>` labelled "Rows per page"; options `10`, `20` (default), `50` |

The loading row has no hook: `<tr><td colspan="6">Loading…</td></tr>`.

## Visible text
- Header: `Demo Holdings` · links `Positions`, `Documents`, `Comments` · `Acting for` [select] · `admin`
- Filters: placeholder `Issuer or ISIN`; labels `From`, `To`; sort options `Issuer` / `Quantity` / `Trade date`; buttons `Search`, `Export CSV`
- Pagination: `Previous`, `Page 1 of 3 · 57 positions`, `Next`, `Rows per page` [10/20/50]
- First 3 rows, Alpha Capital, sort Issuer, page 1, size 20 (as rendered):

| ISIN | Issuer | Quantity | Market value | Trade date | Status |
| --- | --- | --- | --- | --- | --- |
| CA7386114965 | Aster Holdings | 836122 | 184306372.46 | 2026-10-27 | CLOSED |
| US2824531465 | Aster Holdings | 139220 | 4647163.60 | 2026-10-29 | CLOSED |
| FR4568184129 | Aster Holdings | 43714 | 11586832.84 | 2026-10-29 | CLOSED |

- Status values seen: `NEW`, `INVESTIGATING`, `CLOSED`.
- Beta Partners (landing tenant), first row before the switch: `DE4509874641 | Cobalt Mining | 128446 | 28048753.02 | 2026-10-27 | NEW`; `Page 1 of 1 · 12 positions`.

## Network
REST only, all `GET /api/v1/positions`. Response shape is `{ items[], page, size, total }`, and each item is `{ id, isin, issuer, quantity, marketValue, tradeDate, status }` (quantity and marketValue are JSON numbers). Timing for the two load rows comes from `performance.getEntriesByType('resource')`. All other timings run from Playwright request start to request finished. 22 API calls in total. Each action made exactly one call, apart from the inputs that made none. No duplicate or extra calls.

| Action | Call | Variables / query | Status | ms |
| --- | --- | --- | --- | --- |
| Initial load after login (tenant Beta) | GET /api/v1/positions | `page=1&size=20&sort=issuer` → total 12 | 200 | 2 |
| Tenant switch to Alpha (full page reload) | GET /api/v1/positions | `page=1&size=20&sort=issuer` → total 57, 20 items | 200 | 5 |
| Search "Cobalt" (matches) | GET /api/v1/positions | `page=1&size=20&sort=issuer&q=Cobalt` → total 5 | 200 | 10 |
| Search "zzzz-no-match" | GET /api/v1/positions | `page=1&size=20&sort=issuer&q=zzzz-no-match` → total 0, 0 items | 200 | 8 |
| Clear search + Search | GET /api/v1/positions | `page=1&size=20&sort=issuer` → total 57 | 200 | 12 |
| Sort → Quantity (fires on change, no Search needed) | GET /api/v1/positions | `page=1&size=20&sort=quantity` | 200 | 7 |
| Sort → Trade date (on change) | GET /api/v1/positions | `page=1&size=20&sort=tradeDate` | 200 | 6 |
| Sort → Issuer (on change) | GET /api/v1/positions | `page=1&size=20&sort=issuer` | 200 | 8 |
| Fill From only / fill To only | none | Date inputs do not fetch on change | n/a | n/a |
| From 2026-10-28, To 2026-10-29, Search | GET /api/v1/positions | `page=1&size=20&sort=issuer&from=2026-10-28&to=2026-10-29` → total 26 | 200 | 9 |
| From = To = 2026-10-30, Search | GET /api/v1/positions | `page=1&size=20&sort=issuer&from=2026-10-30&to=2026-10-30` → total 13 | 200 | 8 |
| Clear dates + Search | GET /api/v1/positions | `page=1&size=20&sort=issuer` | 200 | 15 |
| Next (p1 → p2) | GET /api/v1/positions | `page=2&size=20&sort=issuer` → 20 items | 200 | 12 |
| Next (p2 → p3) | GET /api/v1/positions | `page=3&size=20&sort=issuer` → 17 items | 200 | 7 |
| Previous (p3 → p2) | GET /api/v1/positions | `page=2&size=20&sort=issuer` (same 20 ids as before) | 200 | 10 |
| Rows per page → 10 (from page 2) | GET /api/v1/positions | `page=1&size=10&sort=issuer`, so the page resets to 1 → "Page 1 of 6 · 57 positions" | 200 | 17 |
| Rows per page → 50 | GET /api/v1/positions | `page=1&size=50&sort=issuer` → "Page 1 of 2 · 57 positions" | 200 | 9 |
| Sort → Quantity at size 50 | GET /api/v1/positions | `page=1&size=50&sort=quantity` | 200 | 7 |
| Next at size 50, Quantity | GET /api/v1/positions | `page=2&size=50&sort=quantity` → 7 items | 200 | 20 |
| Sort → Trade date from page 2 (size 50) | GET /api/v1/positions | `page=1&size=50&sort=tradeDate`, so the page resets to 1 | 200 | 39 |
| Rows per page → 20 | GET /api/v1/positions | `page=1&size=20&sort=tradeDate` | 200 | n/r |
| Next | GET /api/v1/positions | `page=2&size=20&sort=tradeDate` | 200 | 8 |
| Search "Cobalt" from page 2 | GET /api/v1/positions | `page=1&size=20&sort=tradeDate&q=Cobalt`, so the page resets to 1 | 200 | 9 |
| Enter key in search box ("Ember") | none | No request | n/a | n/a |

n/r = not recorded (the call happened; I discarded its timing between steps).

Paging integrity (sort Issuer, size 20): the three pages had 20 + 20 + 17 = 57 rows, 57 unique ids and no duplicates. The rendered row order matched the API `items` order on every page I checked.

Date filter totals: 28–29 Oct = 26, 30 Oct = 13, unfiltered = 57. Every row in each filtered result fell inside the range, and both ends of the range are included.

## States
- **Loading:** `Loading…` in one full-width row (`<tr><td colspan="6">Loading…</td></tr>`, no data-qa). A MutationObserver caught it in the tbody for about 7 ms during the no-match search, so it is too brief to see by eye.
- **Empty:** `No positions match your search.` (`data-qa="positions-empty"`, its `hidden` attribute is removed). Reached by searching `zzzz-no-match` with Search. The table headers stay visible with zero body rows. The summary reads `Page 1 of 1 · 0 positions`, and Previous and Next are both disabled.
- **Error:** not observed. No API call failed, and the UI offers no way to reach an invalid page: Previous is disabled on page 1 and Next on the last page. The only console error was `Failed to load resource: ... 404 (Not Found) @ /favicon.ico`.

## Observations
- **Quantity sort orders numbers as text.** I chose Sort → Quantity at Rows per page 50, then paged to page 2. The UI showed `… 385617, 417191, 43714, 438241, …, 862450, 87343, 90668, 912398, …` on page 1 and `919697 … 989419` on page 2, so 43714 (the smallest quantity) sits in 20th place and 87343 and 90668 sit between 862450 and 912398. The API response for `sort=quantity` (`page=1&size=50` and `page=2&size=50`) returned `items` in exactly that order, with `quantity` as JSON numbers. At the default size 20, page 1 of the Quantity sort ends with `417191, 43714`.
- **Enter in the search box does nothing, and the input stops matching the grid.** After a Cobalt search, I typed `Ember` in `Issuer or ISIN` and pressed Enter. No request was sent. The grid still showed the 5 Cobalt rows and `Page 1 of 1 · 5 positions` while the input read `Ember`. The input is not inside a `<form>`. Only the Search button triggers the search.
- **Search and date inputs need Search; sort and page size apply at once.** Filling From or To made no request until Search was clicked. Changing the sort or Rows per page fetched straight away and reset to page 1. Searching from page 2 also reset to page 1.
- **A fresh login lands on Beta Partners, not the configured default tenant (Alpha Capital).** On first load after sign-in, the switcher showed `Beta Partners` selected, with `Page 1 of 1 · 12 positions`.
- **The tenant switch reloads the whole page.** The navigation entry after the switch had type `reload`. The tenant is carried by the cookie `qip_demo_tenant`; API URLs have no tenant parameter and requests have no tenant header.
- **Numbers are shown raw.** Market value is rendered exactly as the API value, with 2 decimals, no thousands separators and no currency (for example `184306372.46`, `4647163.60`). Quantity has no separators (`836122`). Trade date uses ISO `yyyy-mm-dd`.
- **The sort dropdown has no accessible name.** `positions-sort` has no `<label>` and no `aria-label`; the accessibility tree lists it as an unnamed combobox. The other filters are labelled ("From", "To", "Rows per page", "Acting for"), and the search input has only a placeholder.
- **Trade date sort only orders by date.** Rows within the same date (for example the 18 rows on 2026-10-27) are not ordered by issuer or by id. There is no control for sort direction; every sort I saw was ascending.
- **Counts match.** The page summary total always matched the API `total`. Rendered row counts matched `items.length` (20/20/17, 10, 50/7, 5, 13, 0).
