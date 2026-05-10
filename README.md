# Google Wallet Codelab

## Overview

This project contains sample code used for the [Google Wallet codelab for Web](https://codelabs.developers.google.com/add-to-wallet-web). This codelab demonstrates how to perform the following tasks:

This repository contains the resources used in the
[Create passes on Android using the Google Wallet API](https://codelabs.developers.google.com/add-to-wallet-android)
codelab. This codelab demonstrates how to perform the following tasks:

1.  Create a new issuer account in development mode
1.  Create a service account for issuing passes
1.  Create a new Generic pass class
1.  Create a new pass object
1.  Create an "Add to Google Wallet" button to save a pass
1.  Display the button in your Web application

## Code Files

| Directory | Description |
|------------------------------------------|----------------------------------------------|
| [web/](./web/)                           | The sample app that you will customize       |
| [web_complete/](./web_complete/)         | The same sample app with all steps completed |

## Support

For any questions or issues, please submit an issue on this repository.

## Auto check-in safety

The automatic check-in switches (`AUTO_PASS_CREATION`, `AUTO_VISIT_RECORDING`,
`AUTO_CLICK_CREATION_LINKS`, and `AUTO_CLICK_RECORDING_LINKS`) can be limited to
links that include a shared token. Set `CHECKIN_AUTO_TOKEN` and write the NFC tag
with a URL like:

```text
https://your-domain.example/?checkin=<CHECKIN_AUTO_TOKEN>
```

When `CHECKIN_AUTO_TOKEN` is set, visits to `/` without the matching `checkin` or
`autoToken` query parameter keep the manual buttons available but do not run the
automatic flow. This prevents an old browser tab or bare homepage visit from
recording a check-in just because the automatic environment variables are on.

To try to leave the browser after the wallet link opens, set
`CLOSE_AFTER_WALLET_REDIRECT=true`. Browsers may block scripted tab closing when
the tab was not opened by JavaScript, so this is a best-effort cleanup rather
than an access-control mechanism.
