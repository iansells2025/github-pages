# Gmail Priority Inbox: Oldest First

A small Chrome extension that adds an **Oldest first** switch to Gmail's top bar,
just left of the Settings gear. Turn it on and each Priority Inbox section
(Important and unread, Starred, Everything else) shows its oldest emails at the top.
Turn it off to go back to Gmail's normal newest-first order.

## Install (about 1 minute)

1. Download this folder (`gmail-oldest-first`) to your computer.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `gmail-oldest-first` folder.
5. Open or refresh Gmail. The switch appears next to the gear icon.

## How it works

- Only runs on your Priority Inbox page (`#inbox`, including later pages).
  Other labels, search results and open emails are left alone.
- Flips the emails Gmail has loaded on the current page (up to your
  "max page size" setting, default 50). It does not fetch older pages.
- The order is flipped visually; Gmail's data is never changed. Clicking,
  selecting, archiving and new mail all work as usual.
- Your on/off choice is remembered and synced across Chrome.
- No data leaves your browser, and it needs no Google account access.

## Known limits

- Keyboard shortcuts `j`/`k` still follow Gmail's original order, so on screen
  they move up/down the opposite way while the switch is on.
- If Gmail can't find the Settings gear (for example, Gmail set to a language
  other than English), the switch floats in the top-right corner instead.
- Gmail changes its page often. If the switch stops working after a Gmail
  update, the page structure probably changed and the extension needs a tweak.
