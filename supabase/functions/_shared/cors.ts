// The browser calls these functions directly, so they must answer CORS preflight.
// Access is still controlled by the user's JWT (verify_jwt = true), not by origin.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
