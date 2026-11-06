# Fixtures

SYNTHETIC payloads and pages used by `scrape/tests/prices.test.mjs` and
`scrape/verify-prices.mjs` so the price pipeline can be tested without network
access. They are shaped like what WebTic, spazioCinema/Anteo and 18tickets
serve, but every title, cinema, tariff and text here is invented for the test.

Do not read prices from these files as if they were real: real prices come only
from a live `cd scrape && node run.mjs` on a machine that can reach the sites.
