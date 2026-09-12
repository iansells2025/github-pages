/* Point the board at your API server.

   Leave apiBase empty and the page runs in offline demo mode: the seeded
   board plus whatever you bid, kept in this browser's localStorage, with a
   simulated checkout that takes no money. That is what GitHub Pages serves,
   since Pages cannot host the backend.

   Set apiBase to your deployed server (see server/README.md) and the same
   page becomes the real thing: submissions, ranking and Stripe payments all
   handled server-side, shared by every visitor.

   e.g. apiBase: "https://outdeals-api.fly.dev" */
window.OUTDEALS_CONFIG = {
  apiBase: ""
};
