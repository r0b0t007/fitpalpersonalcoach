{{-- The account mails (App\Mail\AccountMail), HTML part, in the E1 design agreed in Claude Design
     ("FitPal Coach R4 screens", CHW-234): the email/ palette, the gold uppercase wordmark as live
     text, a 3px gold button, 24px gutters, built for a phone first. The sign-in mail rendered from
     this view is email/signin-link-{fr,en,es,de}.html, and a test keeps the two identical: change
     one, regenerate the other (tests/Feature/AccountMailTest.php says how). Tables and inline
     styles only, because Gmail drops <style> for the clients that matter; the <style> blocks are
     extras for the ones that read them, and the <!--[if mso]> parts hold desktop Outlook, which
     ignores max-width and padding on a link, to the same 600px and the same button. No web font:
     a security mail makes no request to anyone else when it is opened, so Archivo shows only where
     it is installed and the system stack stands in. --}}
<!doctype html>
<html lang="{{ $lang }}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>{{ $w['subject'] }}</title>
<style type="text/css">
  body { margin:0 !important; padding:0 !important; width:100% !important; }
  table { border-collapse:collapse !important; }
  a { color:#D4AF37; }
</style>
<style type="text/css">
  /* Outlook.com marks what it recolours with data-ogsc (text) / data-ogsb (background); kept in
     their own block so a client that rejects attribute selectors keeps the rules above. */
  [data-ogsb] .ground, .ground[data-ogsb] { background-color:#1C1A17 !important; }
  [data-ogsc] .ink, .ink[data-ogsc]       { color:#F2EDE4 !important; }
  [data-ogsc] .mute, .mute[data-ogsc]     { color:#A9A198 !important; }
  [data-ogsc] .gold, .gold[data-ogsc]     { color:#D4AF37 !important; }
  [data-ogsb] .cta-bg, .cta-bg[data-ogsb] { background-color:#D4AF37 !important; }
  [data-ogsc] .cta, .cta[data-ogsc]       { color:#14120F !important; }
</style>
<!--[if mso]><style type="text/css">.cta-td { padding:14px 24px !important; }</style><![endif]-->
</head>
<body class="ground" style="margin:0;padding:0;background-color:#1C1A17;">
{{-- The preheader: what an inbox shows beside the subject, before the wordmark's text. --}}
<div style="display:none;font-size:1px;color:#1C1A17;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{{ $w['body'] }}&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ground" style="background-color:#1C1A17;">
<tr><td align="center" style="padding:0;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ground" style="max-width:600px;background-color:#1C1A17;font-family:Archivo,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <tr><td style="padding:32px 24px 22px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="26" style="width:26px;padding-right:11px;vertical-align:middle;line-height:0;"><img src="https://fitpal.ma/icon-180.png" width="26" height="26" alt="" style="display:block;width:26px;height:26px;border:0;border-radius:3px;"></td>
      <td class="gold" style="vertical-align:middle;font-size:17px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#D4AF37;">FitPal&nbsp;Coach</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="height:1px;border-top:1px solid #746C62;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
  <tr><td class="ink" style="padding:28px 24px 0 24px;font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.01em;color:#F2EDE4;">{{ $w['heading'] }}</td></tr>
  <tr><td class="ink" style="padding:18px 24px 0 24px;font-size:17px;line-height:1.55;color:#F2EDE4;">
    <p style="margin:0 0 12px 0;">{{ $w['hello'] }}</p>
    <p style="margin:0;">{{ $w['body'] }}</p>
  </td></tr>
@if ($url !== null)
  <tr><td style="padding:26px 24px 0 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="cta-bg cta-td" style="background-color:#D4AF37;border-radius:3px;"><a href="{{ $url }}" class="cta" style="display:inline-block;padding:14px 24px;font-size:15px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#14120F;text-decoration:none;border-radius:3px;">{{ $w['button'] }}</a></td>
    </tr></table>
  </td></tr>
  <tr><td class="mute" style="padding:24px 24px 0 24px;font-size:13px;line-height:1.5;color:#A9A198;">
    {{ $w['fallback'] }}<br><a href="{{ $url }}" class="mute" style="color:#A9A198;word-break:break-all;">{{ $url }}</a>
  </td></tr>
@endif
  <tr><td style="padding:30px 24px 0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="height:1px;border-top:1px solid #746C62;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
  <tr><td class="mute" style="padding:16px 24px 32px 24px;font-size:12px;line-height:1.5;color:#A9A198;">{{ $w['footer'] }}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
