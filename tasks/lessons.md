# Lessons

- When a OneDrive cleanup runs long enough to look interrupted, keep the user informed, resume from the exact verified state, and split further cleanup into bounded operations instead of restarting completed work.
- Treat owner attestation that a credential was rotated separately from verification that every intended server-side consumer uses the new credential generation. Record the former as `owner_attested`, keep the latter `pending` until names and scopes are proven without viewing secret values, and never request or expose credential values, prefixes, fragments, or hashes as evidence.
