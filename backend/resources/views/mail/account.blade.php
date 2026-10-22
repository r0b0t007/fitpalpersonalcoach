{{-- The account mails (App\Mail\AccountMail), HTML part. Provisional until E1 (CHW-234) is agreed:
     the email/ palette, table layout (Outlook-safe), no background images, live text. --}}
<!doctype html>
<html lang="{{ $lang }}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>{{ $w['subject'] }}</title>
</head>
<body style="margin:0;padding:0;background:#1C1A17;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1C1A17;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:Archivo,'Helvetica Neue',Arial,sans-serif;color:#F2EDE4;">
  <tr><td style="padding:0 0 28px 0;font-size:18px;font-weight:700;color:#D4AF37;">
    <img src="https://fitpal.ma/icon-180.png" width="24" height="24" alt="" style="vertical-align:middle;border:0;margin-right:8px;">FitPal Coach
  </td></tr>
  <tr><td style="font-size:24px;font-weight:700;line-height:1.3;padding:0 0 16px 0;">{{ $w['heading'] }}</td></tr>
  <tr><td style="font-size:16px;line-height:1.55;padding:0 0 24px 0;">{{ $w['body'] }}</td></tr>
  @if ($url !== null)
  <tr><td style="padding:0 0 24px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background:#D4AF37;border-radius:6px;">
        <a href="{{ $url }}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#14120F;text-decoration:none;">{{ $w['button'] }}</a>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="font-size:13px;line-height:1.5;color:#A9A198;padding:0 0 24px 0;">
    {{ $w['fallback'] }}<br><a href="{{ $url }}" style="color:#A9A198;word-break:break-all;">{{ $url }}</a>
  </td></tr>
  @endif
  <tr><td style="border-top:1px solid #746C62;padding:16px 0 0 0;font-size:12px;line-height:1.5;color:#A9A198;">{{ $w['footer'] }}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
