<?php

// Input::searchParam is URLSearchParams#get, which the Node API read every query value through.

use App\Support\Input;
use Illuminate\Http\Request;

it('decodes as URLSearchParams does and keeps the first of repeated names', function () {
    $r = Request::create('/x?a=1&a=2&b=x+y&c=%E9&d=a%zzb%4&e=&f&%61%5B%5D=br&g=%20sp%20');
    expect(Input::searchParam($r, 'a'))->toBe('1')
        ->and(Input::searchParam($r, 'b'))->toBe('x y')
        ->and(Input::searchParam($r, 'c'))->toBe("\u{FFFD}")
        ->and(Input::searchParam($r, 'd'))->toBe('a%zzb%4')
        ->and(Input::searchParam($r, 'e'))->toBe('')
        ->and(Input::searchParam($r, 'f'))->toBe('')
        ->and(Input::searchParam($r, 'a[]'))->toBe('br')
        ->and(Input::searchParam($r, 'g'))->toBe(' sp ')
        ->and(Input::searchParam($r, 'h'))->toBeNull();
});
