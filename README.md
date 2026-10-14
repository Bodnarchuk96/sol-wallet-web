# SOL Wallet 8.0 — EUR / UAH

Personal, manually operated budget web application for BMH and family. This repository contains public frontend code **only**, never private financial transactions, banking credentials, passwords, or encrypted backup files.

## EUR + UAH

- Four independent category balances: BMH EUR, BMH UAH, family EUR, family UAH.
- Existing EUR transactions from SOL Wallet 7.0 remain EUR, with their original amounts untouched.
- UAH income, spending, category transfers, and BMH-to-family transfers are separately recorded in the same encrypted vault.
- Name multiple EUR and UAH cards/accounts to tag transactions. This is manual book-keeping, not a bank connection.
- EUR-to-UAH and UAH-to-EUR conversions are logged as two sides of **one actual transaction**, based on the exact source amount and actual net credited amount. No fabricated exchange rate, money transfer, or automatic conversion occurs.
- UAH monthly targets are separate from EUR targets. Separate currencies are **never automatically added** into a combined balance.
- Unified EUR + UAH CSV is intentionally **unencrypted**. Users are warned before export.
- Existing local vault passphrase remains unchanged. Encrypted backup/export should be kept regularly.

## Security and limits

Static site hosted via GitHub Pages. Financial data is encrypted in browser storage using existing vault code (AES-256-GCM / PBKDF2). A browser, device, profile or origin change can prevent automatic access to local data; keep encrypted backups. Real bank transactions, verified live FX rates and multi-device sync are **not** connected. Foreign currency receipts may require correct tax/accounting conversion under applicable law; do not mistake this manual budget for German EÜR, tax filings, or bank statements.
