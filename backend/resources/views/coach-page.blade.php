<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
@if ($page)
<title>{{ $name }} · FitPal Coach</title>
<meta name="description" content="{{ $page->bio !== '' ? $page->bio : $name }}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="FitPal Coach">
<meta property="og:title" content="{{ $name }} · FitPal Coach">
<meta property="og:description" content="{{ $page->bio !== '' ? $page->bio : $name }}">
<meta property="og:url" content="{{ $url }}">
<meta property="og:image" content="{{ $image }}">
<meta name="twitter:card" content="summary">
<meta name="robots" content="index">
@else
<title>FitPal Coach</title>
<meta name="robots" content="noindex">
@endif
<script>location.replace(@json($app));</script>
</head>
<body>
<noscript><p><a href="{{ $app }}">FitPal Coach</a></p></noscript>
</body>
</html>
