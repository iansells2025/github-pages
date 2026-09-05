/* Demo listings the board starts with — used to seed a fresh database and by
   the browser's offline demo mode. Bids here are fictional. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OUTDEALS_SEED = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return [
    // ---- Amazon ----
    { url: "amazon.com/dp/B0CHX3QBCH", title: "Apple AirPods Pro 2 (USB-C)", now: 168.99, was: 249, bid: 4210, age: 51 },
    { url: "amazon.com/dp/B0C7KTQWLZ", title: "Ninja Creami Deluxe Ice Cream Maker", now: 179, was: 249.99, bid: 2870, age: 46 },
    { url: "amazon.com/dp/B09B8V1LZ3", title: "Echo Dot (5th Gen) Smart Speaker", now: 22.99, was: 49.99, bid: 1615, age: 44 },
    { url: "amazon.com/dp/B08N5WRWNW", title: "Anker 737 Power Bank 24K mAh", now: 89.99, was: 149.99, bid: 940, age: 39 },
    { url: "amazon.com/dp/B0BSHF7WHW", title: "Sony WH-1000XM5 Wireless Headphones", now: 298, was: 399.99, bid: 615, age: 33 },
    { url: "amazon.com/dp/B07FZ8S74R", title: "Lodge 12in Cast Iron Skillet", now: 24.9, was: 44.9, bid: 310, age: 29 },
    { url: "amazon.com/dp/B0BDHB4Z1K", title: "Kindle Paperwhite 16GB", now: 109.99, was: 159.99, bid: 145, age: 24 },
    { url: "amazon.com/dp/B0C1J8QP7X", title: "Stanley Quencher 40oz Tumbler", now: 29.75, was: 45, bid: 64, age: 18 },
    { url: "amazon.com/dp/B09JQMJHXY", title: "Bose SoundLink Flex Speaker", now: 119, was: 149, bid: 28, age: 11 },
    { url: "amazon.com/dp/B0899VXM8F", title: "Crest 3D Whitestrips 22ct", now: 29.99, was: 49.99, bid: 9, age: 5 },
  
    // ---- Target ----
    { url: "target.com/p/dyson-airwrap-multi-styler/-/A-88259231", title: "Dyson Airwrap Multi-Styler", now: 479.99, was: 599.99, bid: 3355, age: 49 },
    { url: "target.com/p/threshold-6pc-towel-set/-/A-83217449", title: "Threshold 6pc Bath Towel Set", now: 27.99, was: 49.99, bid: 1180, age: 43 },
    { url: "target.com/p/keurig-k-mini-single-serve/-/A-77588965", title: "Keurig K-Mini Single-Serve Brewer", now: 59.99, was: 99.99, bid: 720, age: 37 },
    { url: "target.com/p/lego-icons-botanical-orchid/-/A-85376112", title: "LEGO Icons Botanical Orchid", now: 39.99, was: 59.99, bid: 405, age: 31 },
    { url: "target.com/p/all-in-motion-yoga-mat-5mm/-/A-79930544", title: "All In Motion 5mm Yoga Mat", now: 14, was: 25, bid: 190, age: 26 },
    { url: "target.com/p/good-gather-coffee-1lb/-/A-54761923", title: "Good & Gather Whole Bean Coffee 1lb", now: 6.99, was: 10.99, bid: 88, age: 20 },
    { url: "target.com/p/casaluna-linen-duvet-cover/-/A-81205577", title: "Casaluna Linen Duvet Cover", now: 89.25, was: 149, bid: 41, age: 14 },
    { url: "target.com/p/hearth-hand-stoneware-mug/-/A-87664301", title: "Hearth & Hand Stoneware Mug", now: 5.6, was: 8, bid: 12, age: 7 },
  
    // ---- Walmart ----
    { url: "walmart.com/ip/onn-50-4k-roku-tv/1567890123", title: 'onn. 50" 4K Roku Smart TV', now: 178, was: 298, bid: 2640, age: 48 },
    { url: "walmart.com/ip/instant-pot-duo-6qt/1099322145", title: "Instant Pot Duo 7-in-1 6qt", now: 59, was: 99, bid: 1420, age: 42 },
    { url: "walmart.com/ip/mainstays-5pc-cookware/2233445566", title: "Mainstays 5pc Nonstick Cookware", now: 24.88, was: 44.88, bid: 830, age: 36 },
    { url: "walmart.com/ip/hp-15-laptop-8gb-256gb/3344556677", title: 'HP 15.6" Laptop 8GB / 256GB', now: 279, was: 429, bid: 520, age: 30 },
    { url: "walmart.com/ip/athletic-works-fleece-hoodie/4455667788", title: "Athletic Works Fleece Hoodie", now: 9.98, was: 16.98, bid: 260, age: 25 },
    { url: "walmart.com/ip/great-value-olive-oil-51oz/5566778899", title: "Great Value Olive Oil 51oz", now: 12.44, was: 18.98, bid: 110, age: 19 },
    { url: "walmart.com/ip/beats-studio-buds-plus/6677889900", title: "Beats Studio Buds +", now: 99.95, was: 169.99, bid: 55, age: 13 },
    { url: "walmart.com/ip/ozark-trail-40oz-tumbler/7788990011", title: "Ozark Trail 40oz Tumbler", now: 12.98, was: 19.98, bid: 16, age: 8 }
  ];
});
