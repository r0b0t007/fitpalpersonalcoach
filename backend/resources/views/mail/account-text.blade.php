{{-- The account mails (App\Mail\AccountMail), plain-text part: the same words as the HTML, unescaped (text, not markup). --}}
{!! $w['heading'] !!}

{!! $w['body'] !!}
@if ($url !== null)

{!! $w['button'] !!}: {!! $url !!}
@endif

--
{!! $w['footer'] !!}
