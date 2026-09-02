# V0-09 Recovery RC2 page soak

Generated: 2026-08-30T21:03:26.820Z

The exact historical pages were fetched only through the bounded SSRF-safe production transport. Raw HTML remained ephemeral. The exact Tom's Guide Anker review crossed fetch, extraction, exact admission, typed persistence, replay and bounded model-input projection in a disposable database.

```json
{
  "schemaVersion": 1,
  "diagnostic": "v0_09_recovery_rc2_page_soak",
  "generatedAt": "2026-08-30T21:03:26.820Z",
  "sourceDiagnostics": [
    {
      "outcome": "fetched",
      "key": "toms-guide-anker-review",
      "requestedUrl": "https://www.tomsguide.com/computing/peripherals/anker-2-4g-wireless-vertical-ergonomic-mouse-review",
      "requestedHost": "www.tomsguide.com",
      "finalUrl": "https://www.tomsguide.com/computing/peripherals/anker-2-4g-wireless-vertical-ergonomic-mouse-review",
      "finalHost": "www.tomsguide.com",
      "sourceRole": "independent_review",
      "responseStatus": 200,
      "declaredContentLength": 2329807,
      "encodedBytes": 2329807,
      "decodedBytes": 2329807,
      "redirectCount": 0,
      "retainedDocumentBytes": 12815,
      "retainedVisibleTextCharacters": 10735,
      "canonicalUrlCandidate": "https://www.tomsguide.com/computing/peripherals/anker-2-4g-wireless-vertical-ergonomic-mouse-review",
      "title": "Anker 2.4G Wireless Vertical Ergonomic mouse review | Tom's Guide",
      "products": [
        {
          "name": "Anker 2.4G Wireless Vertical Ergonomic mouse review",
          "brand": null,
          "model": null,
          "sku": null,
          "mpn": null
        }
      ],
      "admission": {
        "decision": "admit",
        "sourceRole": "independent_review"
      },
      "durationMs": 349
    },
    {
      "outcome": "fetched",
      "key": "anker-product",
      "requestedUrl": "https://www.anker.com/products/a7582",
      "requestedHost": "www.anker.com",
      "finalUrl": "https://www.anker.com/products/a7582",
      "finalHost": "www.anker.com",
      "sourceRole": "other",
      "responseStatus": 200,
      "declaredContentLength": 1943252,
      "encodedBytes": 1943252,
      "decodedBytes": 1943252,
      "redirectCount": 0,
      "retainedDocumentBytes": 6154,
      "retainedVisibleTextCharacters": 4196,
      "canonicalUrlCandidate": "https://www.anker.com/products/a7582",
      "title": "Anker 2.4G Wireless Vertical Ergonomic Optical Mouse - Anker US",
      "products": [
        {
          "name": "Anker 2.4G Wireless Vertical Ergonomic Optical Mouse",
          "brand": "Anker",
          "model": null,
          "sku": "A7852011",
          "mpn": null
        }
      ],
      "admission": {
        "decision": "admit",
        "sourceRole": "manufacturer"
      },
      "durationMs": 677
    },
    {
      "outcome": "fetched",
      "key": "amazon-kensington-retailer",
      "requestedUrl": "https://www.amazon.co.uk/Kensington-Rechargeable-Bluetooth-Post-Consumer-K72482WW/dp/B0DDTPGZ66",
      "requestedHost": "www.amazon.co.uk",
      "finalUrl": "https://www.amazon.co.uk/Kensington-Rechargeable-Bluetooth-Post-Consumer-K72482WW/dp/B0DDTPGZ66",
      "finalHost": "www.amazon.co.uk",
      "sourceRole": "retailer",
      "responseStatus": 200,
      "declaredContentLength": null,
      "encodedBytes": 1660461,
      "decodedBytes": 1660461,
      "redirectCount": 0,
      "retainedDocumentBytes": 27152,
      "retainedVisibleTextCharacters": 23931,
      "canonicalUrlCandidate": "https://www.amazon.co.uk/Kensington-Rechargeable-Bluetooth-Post-Consumer-K72482WW/dp/B0DDTPGZ66",
      "title": "Kensington Pro Fit Ergo MY630 EQ Rechargeable Bluetooth Mouse with 2.4GHz USB-A Reciever, 57% Post-Consumer Recycled (SCS) Content, With Up to 4 Months Of Battery Life Per Charge (K72482WW) : Amazon.co.uk: Computers & Accessories",
      "products": [],
      "admission": {
        "decision": "reject",
        "reason": "wrong_model_or_variant"
      },
      "durationMs": 1924
    }
  ],
  "persistenceReplay": {
    "taskId": "0d303e9e-0833-4610-b26e-98daf7636553",
    "searchRunId": "5e118952-eb0b-4c3b-b51d-f8e645881c87",
    "researchRunId": "0da072e3-b24a-40d0-a2fb-b8efe3b817c1",
    "researchStatus": "succeeded",
    "fetchedSourceRole": "independent_review",
    "requestedUrl": "https://www.tomsguide.com/computing/peripherals/anker-2-4g-wireless-vertical-ergonomic-mouse-review",
    "finalUrl": "https://www.tomsguide.com/computing/peripherals/anker-2-4g-wireless-vertical-ergonomic-mouse-review",
    "encodedBytes": 2329807,
    "decodedBytes": 2329807,
    "responseHashMatchesFetch": true,
    "documentHashMatchesReplay": true,
    "retainedDocumentBytes": 12815,
    "retainedVisibleTextBytes": 10868,
    "retainedDocumentWithinEnvelope": true,
    "fetchedPageEnteredModel": true,
    "modelSourceCount": 3,
    "modelSourceMatchesReplay": true,
    "rawResponseRetention": "schema_excludes_raw_response_body"
  },
  "cleanup": {
    "disposableDatabaseDestroyed": true,
    "errorCount": 0
  }
}
```
