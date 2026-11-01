# CHW-330 Public coach page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coach claims a handle and publishes a page at `coach.fitpal.ma/c/<handle>`. The page unfurls with their name and bio in WhatsApp and Instagram, and opens a public coach card in the app, in the coach's chosen theme.

**Architecture:**
- **Data.** A new tenant-owned table `coach_pages`, one row per coach, keyed by `coach_id` and using `OwnedByCoach`. It holds the handle (unique across coaches), bio, WhatsApp number, open flag and theme.
- **Server-rendered link page.** Laravel serves `/api/c/{handle}` as a tiny HTML page: Open Graph tags, then `location.replace('/#/c/<handle>')`. Link previews need per-coach tags in server HTML, which the `HashRouter` app can't produce.
- **The page itself is React.** It renders at `/c/:handle`, before either shell like `/link`, from `GET /api/public/coach?h=`, so all its copy uses the existing `t()` packs.
- **Editor.** The coach edits the page at Account › My page (`/account/page`), saving through `POST /api/coach/page/save` behind `RequireWriter`.
- **Short URL.** A rewrite rule in the server-owned docroot `.htaccess` maps `/c/<handle>` to `/api/c/<handle>`; it's documented, not deployed by CI.

**Tech Stack:** Laravel 13 / PHP 8.4, Blade, Pest; React 19, Vitest (happy-dom).

**Spec:** `docs/superpowers/specs/2026-11-01-creator-coach-design.md` §3.1. **Issue:** CHW-330.

## Global Constraints

- **Dependencies:** none new.
- **App strings:** every user-facing app string goes through `t()`, with an entry in `frontend/src/locales/{fr,es,de}.js`. `npm run check:i18n` must pass. French uses « vous ». Spanish and German use the packs' existing tú/du. Packs say « passkey ».
- **API errors:**
  - Every `Json::error`/`ClientSafe` message is a key in all three packs (`backend/scripts/check-error-strings.mjs`).
  - This plan adds six:
    - `handles are 3–30 letters, numbers, dots or underscores`
    - `that handle is taken`
    - `keep the bio to 160 characters`
    - `that is not a phone number — include the country code`
    - `no such coach page`
    - `this coach is not taking requests right now`
- **Audit:** the new event `coach.page.save` gets a label in `frontend/src/lib/audit.js`. `EVENT_FLOOR`/`LABEL_FLOOR` in `backend/scripts/check-audit-labels.mjs` go from 43 to 44.
- **Tenancy:**
  - Nothing under `app/` filters on `coach_id` by hand (`TenantModelsTest`). The one cross-coach read, the handle lookup, uses `CoachPage::acrossCoaches()` with a `// across coaches: …` comment on that line.
  - `TenantModelsTest` already requires every model with a `coach_id` column to use `OwnedByCoach`.
- **Out of scope:**
  - The coach's photo; the preview uses the app icon (a follow-up issue).
  - `auto_accept` and `starter_program_id` (CHW-338).
  - The join flow behind the page's button (CHW-336); until then `/#/join/<handle>` falls to the sign-in screen.
  - Moroccan-local number normalisation (CHW-341).
- **Local backend tests:** `OPENSSL_CONF='C:\xampp\php\extras\ssl\openssl.cnf' php vendor/bin/pest` (push tests need it).

## File map

| File | Change |
|---|---|
| `backend/database/migrations/2026_11_01_120000_create_coach_pages_table.php` | new |
| `backend/app/Models/CoachPage.php` | new model |
| `backend/app/Coaching/Handle.php` | new: normalise, validate, reserved |
| `backend/app/Support/Phone.php` | new: digits for wa.me |
| `backend/app/Http/Controllers/CoachPageController.php` | new: GET/POST the coach's own page |
| `backend/app/Http/Controllers/PublicPageController.php` | new: the HTML link page and the public JSON |
| `backend/resources/views/coach-page.blade.php` | new |
| `backend/routes/api.php` | four routes |
| `backend/app/Tenancy/Detach.php` | closes the page of a detached coach |
| `backend/tests/Feature/CoachPageTest.php` | new |
| `backend/scripts/check-audit-labels.mjs` | floors 43 → 44 |
| `frontend/src/lib/coach-page.js` (+ `.test.js`) | new |
| `frontend/src/views/PublicCoach.jsx` (+ `.test.jsx`) | new: `/c/:handle` |
| `frontend/src/views/coach/PublicPage.jsx` (+ `.test.jsx`) | new: the editor |
| `frontend/src/App.jsx` | route `/c/…` before the shells; `/account/page` |
| `frontend/src/views/coach/CoachAccount.jsx` | "My page" row |
| `frontend/src/lib/audit.js` | `coach.page.save` label |
| `frontend/src/locales/{fr,es,de}.js` | strings and error keys |
| `docs/DEPLOY_COACH_SUBDOMAIN.md`, `docs/API.md` | the rewrite rule; the routes |

---

### Task 1: The `coach_pages` table, `CoachPage`, `Handle`, `Phone`

**Files:**
- Create: the migration, `app/Models/CoachPage.php`, `app/Coaching/Handle.php`, `app/Support/Phone.php`
- Test: `backend/tests/Feature/CoachPageTest.php` (unit-style cases at the top of the file)

**Interfaces:**
- Produces:
  - `Handle::normalise(mixed): string`, `Handle::valid(string): bool`, `Handle::reserved(string): bool`
  - `Phone::digits(mixed): ?string`: `''` for blank, the digits for a valid number, `null` for invalid
  - `CoachPage` with `toCoach(): array` and `toPublic(User $coach): array`

- [ ] **Step 1: Failing tests**

```php
<?php

// The coach's public page (CHW-330, spec §3.1): one handle per coach, the link page with its
// preview tags, the public card the app draws, and the editor's save.

use App\Coaching\Handle;
use App\Models\CoachPage;
use App\Support\Phone;
use Tests\Support\Billing;
use Tests\Support\Coaching;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.origin' => 'https://coach.example', 'fitpal.free_cap' => 0]);
    $this->f = Coaching::twoCoaches();
});

it('reads a handle as Instagram writes it, and keeps it to what a URL can carry', function () {
    expect(Handle::normalise(' @Sara.Fit '))->toBe('sara.fit')
        ->and(Handle::normalise(['x']))->toBe('')
        ->and(Handle::valid('sara.fit'))->toBeTrue()
        ->and(Handle::valid('sa'))->toBeFalse()
        ->and(Handle::valid(str_repeat('a', 31)))->toBeFalse()
        ->and(Handle::valid('sara-fit'))->toBeFalse()
        ->and(Handle::valid('.sara'))->toBeFalse()
        ->and(Handle::valid('sara.'))->toBeFalse()
        ->and(Handle::valid('sa..ra'))->toBeFalse()
        ->and(Handle::reserved('admin'))->toBeTrue()
        ->and(Handle::reserved('sara.fit'))->toBeFalse();
});

it('keeps a WhatsApp number as the digits wa.me wants, with its country code', function () {
    expect(Phone::digits(''))->toBe('')
        ->and(Phone::digits(null))->toBe('')
        ->and(Phone::digits('+212 6 12-34-56-78'))->toBe('212612345678')
        ->and(Phone::digits('00 34 612 345 678'))->toBe('34612345678')
        ->and(Phone::digits('(+33) 6 12 34 56 78'))->toBe('33612345678')
        ->and(Phone::digits('0612345678'))->toBeNull()        // no country code: wa.me cannot dial it
        ->and(Phone::digits('12345'))->toBeNull()
        ->and(Phone::digits('+212 6 12 34 abc'))->toBeNull();
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `php vendor/bin/pest tests/Feature/CoachPageTest.php`. Expected: class not found.

- [ ] **Step 3: Implement**

`backend/database/migrations/2026_11_01_120000_create_coach_pages_table.php`:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A coach's public page (CHW-330): the one link in their Instagram bio. One row per coach,
        // keyed by the coach; the handle is unique across every coach, stored lowercase.
        Schema::create('coach_pages', function (Blueprint $table) {
            $table->string('coach_id', 16)->primary();
            $table->string('handle', 30)->unique();
            $table->string('bio', 160)->default('');
            $table->string('whatsapp', 20)->default('');   // digits with the country code, for wa.me
            $table->boolean('open')->default(false);
            $table->string('theme', 5)->default('dark');    // dark | light — the coach picks (CHW-323)
            // Epoch milliseconds, as every other coach table keeps them.
            $table->bigInteger('created');
            $table->bigInteger('updated');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('coach_pages');
    }
};
```

`backend/app/Coaching/Handle.php`:

```php
<?php

namespace App\Coaching;

/**
 * A coach page's handle (CHW-330): what follows coach.fitpal.ma/c/. Read the way a coach types
 * their Instagram name — a leading @ and capitals are dropped — and kept to what Instagram itself
 * allows, minus the dots a URL path would trip on at either end.
 */
final class Handle
{
    /** The app's own paths and words a visitor would mistake for FitPal speaking. */
    public const RESERVED = ['api', 'admin', 'c', 'join', 'start', 'link', 'home', 'today', 'clients', 'programs',
        'account', 'settings', 'login', 'fitpal', 'coach', 'support', 'help', 'www', 'app'];

    public static function normalise(mixed $raw): string
    {
        return is_string($raw) ? strtolower(ltrim(trim($raw), '@')) : '';
    }

    public static function valid(string $handle): bool
    {
        return (bool) preg_match('/^[a-z0-9._]{3,30}$/D', $handle)
            && ! str_starts_with($handle, '.') && ! str_ends_with($handle, '.') && ! str_contains($handle, '..');
    }

    public static function reserved(string $handle): bool
    {
        return in_array($handle, self::RESERVED, true);
    }
}
```

`backend/app/Support/Phone.php`:

```php
<?php

namespace App\Support;

/**
 * A phone number as wa.me dials it: digits only, country code first (CHW-330). Spaces, dashes,
 * dots, brackets and a leading + or 00 are what people type around it and are dropped; anything
 * else, or a number with no country code (a leading 0), is not a number wa.me can open.
 */
final class Phone
{
    /** '' for blank, the digits for a number, null for something that is not one. */
    public static function digits(mixed $raw): ?string
    {
        if ($raw === null || (is_string($raw) && trim($raw) === '')) {
            return '';
        }
        if (! is_string($raw)) {
            return null;
        }
        $s = preg_replace('/[\s\-.()]/', '', $raw);
        $s = str_starts_with($s, '+') ? substr($s, 1) : (str_starts_with($s, '00') ? substr($s, 2) : $s);

        return preg_match('/^[1-9][0-9]{7,14}$/D', $s) ? $s : null;
    }
}
```

`backend/app/Models/CoachPage.php`:

```php
<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;

/**
 * A coach's public page (CHW-330), one per coach and keyed by them. Scoped: OwnedByCoach — a coach
 * route sees only its own page; the public lookup by handle goes acrossCoaches() on purpose.
 */
class CoachPage extends Model
{
    use OwnedByCoach;

    protected $primaryKey = 'coach_id';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = ['handle', 'bio', 'whatsapp', 'open', 'theme', 'created', 'updated'];

    protected function casts(): array
    {
        return ['open' => 'boolean', 'created' => 'integer', 'updated' => 'integer'];
    }

    /** As the editor reads it. */
    public function toCoach(): array
    {
        return ['handle' => $this->handle, 'bio' => $this->bio, 'whatsapp' => $this->whatsapp, 'open' => $this->open, 'theme' => $this->theme];
    }

    /** As anyone with the link reads it: nothing the coach did not write for the public. */
    public function toPublic(User $coach): array
    {
        return ['name' => $coach->name, 'handle' => $this->handle, 'bio' => $this->bio, 'whatsapp' => $this->whatsapp, 'theme' => $this->theme];
    }
}
```

- [ ] **Step 4: Run them and watch them pass**, along with the tenancy guard: `php vendor/bin/pest tests/Feature/CoachPageTest.php tests/Feature/TenantModelsTest.php`. Expected: PASS. The guard accepts `CoachPage`: it has `coach_id` and uses `OwnedByCoach`.

- [ ] **Step 5: Commit:** "Coach page: the table, the model, handles and WhatsApp numbers (CHW-330)".

---

### Task 2: The coach's editor routes: `GET /api/coach/page`, `POST /api/coach/page/save`

**Files:**
- Create: `app/Http/Controllers/CoachPageController.php`
- Modify:
  - `routes/api.php`, in the `RequireCoach` group next to `/coach/programs`:
    - `Route::get('/coach/page', [CoachPageController::class, 'show']);`
    - `Route::post('/coach/page/save', [CoachPageController::class, 'save'])->middleware(RequireWriter::class);`
  - `scripts/check-audit-labels.mjs`: floors 43 → 44
  - `frontend/src/lib/audit.js`: add the `coach.page.save` label, next to `coach.program.save`, in the same shape
  - `frontend/src/locales/{fr,es,de}.js`: the four save error keys (Task 5 adds the rest)
- Test: `tests/Feature/CoachPageTest.php`

**Interfaces:**
- Produces:
  - `GET /api/coach/page` → `{page: {handle, bio, whatsapp, open, theme} | null, url: string|null}`, where `url` is `ORIGIN/c/<handle>`.
  - `POST /api/coach/page/save {handle, bio, whatsapp, open, theme}` → the same shape.
  - Errors:
    - 400 `handles are 3–30 letters, numbers, dots or underscores`
    - 409 `that handle is taken` (also for reserved handles)
    - 400 `keep the bio to 160 characters`
    - 400 `that is not a phone number — include the country code`
  - Read-only coach: the standard 402.

- [ ] **Step 1: Failing tests** (append):

```php
function savePage(object $as, array $body)
{
    return test()->postJson('/api/coach/page/save', $body + ['bio' => '', 'whatsapp' => '', 'open' => true, 'theme' => 'dark'], bearer($as));
}

it('has no page until the coach saves one, then answers it with its link', function () {
    $this->getJson('/api/coach/page', bearer($this->f->a))->assertOk()->assertExactJson(['page' => null, 'url' => null]);
    savePage($this->f->a, ['handle' => '@Sara.Fit', 'bio' => '  Force pour femmes.  ', 'whatsapp' => '+212 612 345 678', 'theme' => 'light'])->assertOk()
        ->assertExactJson(['page' => ['handle' => 'sara.fit', 'bio' => 'Force pour femmes.', 'whatsapp' => '212612345678', 'open' => true, 'theme' => 'light'], 'url' => 'https://coach.example/c/sara.fit']);
    $this->getJson('/api/coach/page', bearer($this->f->a))->assertJsonPath('page.handle', 'sara.fit');
    expect(CoachPage::acrossCoaches()->count())->toBe(1); // across coaches: test counts every row
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.page.save', 'uid' => $this->f->a->id, 'msg' => 'sara.fit']);
});

it('saves over the same row, renames the handle, and keeps an unknown theme dark', function () {
    savePage($this->f->a, ['handle' => 'sara.fit'])->assertOk();
    savePage($this->f->a, ['handle' => 'sara.coach', 'theme' => 'neon', 'open' => 'yes'])->assertOk()
        ->assertJsonPath('page.handle', 'sara.coach')->assertJsonPath('page.theme', 'dark')->assertJsonPath('page.open', false);
    expect(CoachPage::acrossCoaches()->count())->toBe(1); // across coaches: test counts every row
});

it('refuses a handle another coach has, or the app keeps, whatever its case', function () {
    savePage($this->f->b, ['handle' => 'sara.fit'])->assertOk();
    savePage($this->f->a, ['handle' => 'SARA.fit'])->assertStatus(409)->assertExactJson(['error' => 'that handle is taken']);
    savePage($this->f->a, ['handle' => 'admin'])->assertStatus(409)->assertExactJson(['error' => 'that handle is taken']);
    // B keeps theirs, unchanged.
    $this->getJson('/api/coach/page', bearer($this->f->b))->assertJsonPath('page.handle', 'sara.fit');
});

it('says what is wrong with a handle, a bio or a number', function (array $body, int $status, string $error) {
    savePage($this->f->a, $body)->assertStatus($status)->assertExactJson(['error' => $error]);
    expect(CoachPage::acrossCoaches()->count())->toBe(0); // across coaches: test counts every row
})->with([
    'short handle' => [['handle' => 'ab'], 400, 'handles are 3–30 letters, numbers, dots or underscores'],
    'dash' => [['handle' => 'sara-fit'], 400, 'handles are 3–30 letters, numbers, dots or underscores'],
    'long bio' => [['handle' => 'sara.fit', 'bio' => str_repeat('é', 161)], 400, 'keep the bio to 160 characters'],
    'no country code' => [['handle' => 'sara.fit', 'whatsapp' => '0612345678'], 400, 'that is not a phone number — include the country code'],
]);

it('lets a client nowhere near it, and stops a read-only coach saving', function () {
    $this->getJson('/api/coach/page', bearer($this->f->a1))->assertStatus(403);
    Billing::on();   // billing on, no licence, no Free plan: read-only
    savePage($this->f->a, ['handle' => 'sara.fit'])->assertStatus(402);
    $this->getJson('/api/coach/page', bearer($this->f->a))->assertOk();
});
```

- [ ] **Step 2: Run them and watch them fail** (404 for the routes).

- [ ] **Step 3: Implement.** First check how `Input` exposes the raw body value: `CoachProgramController` uses `Input::raw($request, 'id')`.

```php
<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\Handle;
use App\Models\CoachPage;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Support\Phone;
use App\Tenancy\CoachLock;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The coach's own public page (CHW-330): read it, and save it. Runs in the coach's CoachContext,
 * so CoachPage::query() is their page; only the handle's uniqueness looks across coaches.
 */
final class CoachPageController
{
    public const BIO_MAX = 160;

    public function show(Request $request): JsonResponse
    {
        return Json::ok(self::answer(CoachPage::query()->first()));
    }

    public function save(Request $request): JsonResponse
    {
        $coach = $request->user('api');
        $handle = Handle::normalise(Input::raw($request, 'handle'));
        if (! Handle::valid($handle)) {
            throw new ClientSafe(400, 'handles are 3–30 letters, numbers, dots or underscores');
        }
        if (Handle::reserved($handle)) {
            throw new ClientSafe(409, 'that handle is taken');
        }
        $bio = Input::raw($request, 'bio');
        $bio = is_string($bio) ? trim($bio) : '';
        if (mb_strlen($bio) > self::BIO_MAX) {
            throw new ClientSafe(400, 'keep the bio to 160 characters');
        }
        $whatsapp = Phone::digits(Input::raw($request, 'whatsapp'));
        if ($whatsapp === null) {
            throw new ClientSafe(400, 'that is not a phone number — include the country code');
        }
        // Only a real `true` opens it, and only `light` is light: a page is never published by a typo.
        $open = Input::raw($request, 'open') === true;
        $theme = Input::raw($request, 'theme') === 'light' ? 'light' : 'dark';

        try {
            $page = DB::transaction(function () use ($coach, $handle, $bio, $whatsapp, $open, $theme): CoachPage {
                CoachLock::take($coach->id);
                $holder = CoachPage::acrossCoaches()->where('handle', $handle)->first(); // across coaches: a handle is unique across every coach
                if ($holder !== null && $holder->coach_id !== $coach->id) {
                    throw new ClientSafe(409, 'that handle is taken');
                }
                $now = Js::nowMs();
                $page = CoachPage::query()->first() ?? (new CoachPage)->forceFill(['created' => $now]);
                $page->forceFill(['handle' => $handle, 'bio' => $bio, 'whatsapp' => $whatsapp, 'open' => $open, 'theme' => $theme, 'updated' => $now])->save();

                return $page;
            });
        } catch (UniqueConstraintViolationException) {
            // Two coaches claiming one handle at the same moment: the index decides, and the loser hears it.
            throw new ClientSafe(409, 'that handle is taken');
        }
        Audit::record($request, 'coach.page.save', ['user' => $coach, 'msg' => $page->handle]);

        return Json::ok(self::answer($page));
    }

    /** @return array{page: array<string, mixed>|null, url: string|null} */
    private static function answer(?CoachPage $page): array
    {
        return ['page' => $page?->toCoach(), 'url' => $page ? rtrim((string) config('fitpal.origin'), '/').'/c/'.$page->handle : null];
    }
}
```

`ClientSafe` thrown inside `DB::transaction` rolls back and is rendered by the exception handler, the same as `CoachProgramController`'s cap refusal.

Then:
- Add the label in `frontend/src/lib/audit.js`, copying the shape of the `coach.program.save` entry with the text "Saved their public page".
- Raise both floors in `check-audit-labels.mjs` to 44.
- Add the four save error keys to all three packs:

| key | fr | es | de |
|---|---|---|---|
| `handles are 3–30 letters, numbers, dots or underscores` | `un identifiant fait 3 à 30 lettres, chiffres, points ou tirets bas` | `un usuario tiene de 3 a 30 letras, números, puntos o guiones bajos` | `ein Name hat 3–30 Buchstaben, Ziffern, Punkte oder Unterstriche` |
| `that handle is taken` | `cet identifiant est déjà pris` | `ese usuario ya está ocupado` | `dieser Name ist schon vergeben` |
| `keep the bio to 160 characters` | `la bio ne doit pas dépasser 160 caractères` | `la bio no puede pasar de 160 caracteres` | `die Bio darf höchstens 160 Zeichen haben` |
| `that is not a phone number — include the country code` | `ce n’est pas un numéro de téléphone — ajoutez l’indicatif du pays` | `eso no es un número de teléfono — añade el prefijo del país` | `das ist keine Telefonnummer — mit Ländervorwahl angeben` |

Match how existing error keys are cased in the packs. Server messages are lowercase in English; check whether the packs capitalise them, e.g. `grep -n "'that is your own invite link'" frontend/src/locales/fr.js`.

- [ ] **Step 4: Run them and watch them pass:** `php vendor/bin/pest tests/Feature/CoachPageTest.php && node scripts/check-error-strings.mjs && node scripts/check-audit-labels.mjs && cd ../frontend && npm run check:i18n`.

- [ ] **Step 5: Commit:** "Coach page: the coach saves a handle, bio, number and theme (CHW-330)".

---

### Task 3: The public side: `GET /api/c/{handle}` (HTML) and `GET /api/public/coach?h=`; Detach closes the page

**Files:**
- Create: `app/Http/Controllers/PublicPageController.php`, `resources/views/coach-page.blade.php`
- Modify:
  - `routes/api.php`, in the public (no-auth) block next to `Route::get('/invite', …)`:
    - `Route::get('/c/{handle}', [PublicPageController::class, 'html']);`
    - `Route::get('/public/coach', [PublicPageController::class, 'json']);`
  - `app/Tenancy/Detach.php`: close the coach's page.
  - `frontend/src/locales/*`: the two public error keys.
- Test: `tests/Feature/CoachPageTest.php`

**Interfaces:**
- Produces:
  - `GET /api/public/coach?h=<any case, @ ok>`:
    - `{coach: {name, handle, bio, whatsapp, theme}}`;
    - 404 `no such coach page` (unknown handle, coach disabled or no longer a coach);
    - 404 `this coach is not taking requests right now` (closed).
  - `GET /api/c/{handle}`: HTML.
    - 200 with OG/Twitter tags for an open page; 404 with no tags otherwise.
    - Both redirect to `/#/c/<normalised handle>`.

- [ ] **Step 1: Failing tests** (append):

```php
function openPage(object $coach, array $fields = []): CoachPage
{
    return Coaching::own(new CoachPage, $coach, $fields + ['handle' => 'sara.fit', 'bio' => 'Force <b>& co</b>', 'whatsapp' => '212612345678', 'open' => true, 'theme' => 'light', 'created' => 1, 'updated' => 1]);
}

it('answers the public card for an open page, by any spelling of its handle', function () {
    openPage($this->f->a);
    $this->getJson('/api/public/coach?h=@Sara.FIT')->assertOk()->assertExactJson(['coach' => [
        'name' => 'Coach A', 'handle' => 'sara.fit', 'bio' => 'Force <b>& co</b>', 'whatsapp' => '212612345678', 'theme' => 'light',
    ]]);
});

it('tells a closed page from a missing one, and hides the page of a coach who is gone', function () {
    $this->getJson('/api/public/coach?h=nobody')->assertStatus(404)->assertExactJson(['error' => 'no such coach page']);
    $page = openPage($this->f->a, ['open' => false]);
    $this->getJson('/api/public/coach?h=sara.fit')->assertStatus(404)->assertExactJson(['error' => 'this coach is not taking requests right now']);
    $page->forceFill(['open' => true])->save();
    $this->f->a->forceFill(['disabled' => true])->save();
    $this->getJson('/api/public/coach?h=sara.fit')->assertStatus(404)->assertExactJson(['error' => 'no such coach page']);
});

it('serves the link page with escaped preview tags, and sends the visitor on to the app', function () {
    openPage($this->f->a);
    $html = $this->get('/api/c/SARA.fit')->assertOk()->assertHeader('Content-Type', 'text/html; charset=UTF-8')->getContent();
    expect($html)->toContain('<meta property="og:title" content="Coach A · FitPal Coach">')
        ->toContain('<meta property="og:description" content="Force &lt;b&gt;&amp; co&lt;/b&gt;">')
        ->toContain('<meta property="og:url" content="https://coach.example/c/sara.fit">')
        ->toContain('<meta property="og:image" content="https://coach.example/icon-512.png">')
        ->toContain('location.replace("\/#\/c\/sara.fit")')
        ->not->toContain('<b>& co</b>');
    // Served at both mounts, as every route here is.
    $this->get('/c/sara.fit')->assertOk();
});

it('answers 404 with no preview for a closed or unknown page, and still hands the visitor to the app', function () {
    openPage($this->f->a, ['open' => false]);
    foreach (['/api/c/sara.fit', '/api/c/nobody'] as $path) {
        $html = $this->get($path)->assertStatus(404)->getContent();
        expect($html)->not->toContain('og:title')->toContain('<meta name="robots" content="noindex">')->toContain('location.replace(');
    }
});

it('closes the page of a coach who loses the role', function () {
    openPage($this->f->a);
    \App\Tenancy\Detach::coach($this->f->a);
    expect(CoachPage::acrossCoaches()->find($this->f->a->id)->open)->toBeFalse(); // across coaches: test reads A's page with no context
});
```

Notes for the tests:
- `Coaching::own(new X, $coach, $fields)` is the fixture's writer (`tests/Support/Coaching.php`, "written the way the import does"). Check it sets `coach_id` and saves. If it calls `forceFill` with an `id`, it works unchanged for `CoachPage`, because the primary key is `coach_id`.
- `Detach::coach` is called directly the way the existing tests call it: `grep -rn "Detach::coach" backend/tests`. If they wrap it in `CoachLock`/a transaction, do the same.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement**

`app/Http/Controllers/PublicPageController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Coaching\Handle;
use App\Models\CoachPage;
use App\Models\User;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * A coach's page as the public meets it (CHW-330, spec §3.1). No session: anyone with the link.
 *
 *  - /c/{handle} is the link in the bio (rewritten to /api/c/… by the docroot .htaccess). It is a
 *    page of preview tags for Instagram's and WhatsApp's crawlers, which read server HTML only,
 *    and a redirect into the app's #/c/<handle> — everything a person sees is the app's, in their
 *    language.
 *  - /public/coach is what that screen reads.
 *
 * A page shows while it is open and its coach is still an enabled coach.
 */
final class PublicPageController
{
    public function json(Request $request): JsonResponse
    {
        [$page, $coach] = self::find(Handle::normalise($request->query('h')));
        if ($page === null || $coach === null) {
            return Json::error(404, 'no such coach page');
        }
        if (! $page->open) {
            return Json::error(404, 'this coach is not taking requests right now');
        }

        return Json::ok(['coach' => $page->toPublic($coach)]);
    }

    public function html(string $handle): Response
    {
        $handle = Handle::normalise($handle);
        [$page, $coach] = self::find($handle);
        $shown = $page !== null && $coach !== null && $page->open;
        $origin = rtrim((string) config('fitpal.origin'), '/');

        return response()->view('coach-page', [
            'page' => $shown ? $page : null,
            'name' => $coach?->name,
            'url' => $origin.'/c/'.$handle,
            'image' => $origin.'/icon-512.png',
            'app' => '/#/c/'.$handle,
        ], $shown ? 200 : 404)->header('Content-Type', 'text/html; charset=UTF-8');
    }

    /** @return array{0: CoachPage|null, 1: User|null} the page, and its coach if they still coach */
    private static function find(string $handle): array
    {
        if (! Handle::valid($handle)) {
            return [null, null];
        }
        $page = CoachPage::acrossCoaches()->where('handle', $handle)->first(); // across coaches: the public looks a page up by its handle
        $coach = $page ? User::query()->find($page->coach_id) : null;

        return [$page, $coach !== null && $coach->isCoach() && ! $coach->disabled ? $coach : null];
    }
}
```

`resources/views/coach-page.blade.php`:

```blade
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
```

Notes:
- `@json` escapes `/` as `\/`, which the test expects.
- If Blade's escaping of the `·` or `&` differs from the test strings, fix the **test** to what Blade really emits (`e()` is `htmlspecialchars` with `ENT_QUOTES`), never the escaping.
- If `NoStore` or another `api` middleware overwrites `Content-Type`, check what it sets before changing anything.

Detach: add this to `Detach::coach()` after the invites line:

```php
        // Their public page closes with the role: a link in a bio must not keep sending people to
        // a coach who no longer coaches here. Closed, not deleted — the handle stays theirs.
        CoachPage::acrossCoaches()->whereKey($coach->id)->update(['open' => false]); // across coaches: detach runs outside any coach context, for this one coach
```

Also add the `use App\Models\CoachPage;` import.

Add the two public error keys to all three packs:

| key | fr | es | de |
|---|---|---|---|
| `no such coach page` | `cette page coach n’existe pas` | `esta página de coach no existe` | `diese Coach-Seite gibt es nicht` |
| `this coach is not taking requests right now` | `ce coach ne prend pas de demandes pour le moment` | `este coach no acepta solicitudes por ahora` | `dieser Coach nimmt gerade keine Anfragen an` |

- [ ] **Step 4: Run them and watch them pass:** `php vendor/bin/pest tests/Feature/CoachPageTest.php tests/Feature/TenantModelsTest.php tests/Feature/TenancyTest.php`, plus `node scripts/check-error-strings.mjs`.

- [ ] **Step 5: Commit:** "Coach page: the link page with its preview, and the public card (CHW-330)".

---

### Task 4: `lib/coach-page.js` and the public screen at `/c/:handle`

**Files:**
- Create: `frontend/src/lib/coach-page.js` (+ `.test.js`), `frontend/src/views/PublicCoach.jsx` (+ `.test.jsx`)
- Modify: `frontend/src/App.jsx` (`Shell`)

**Interfaces:**
- Produces:
  - `normaliseHandle(s): string`, `validHandle(h): boolean`, `pageUrl(handle, origin = location.origin): string`, `BIO_MAX = 160`, `coachHandleFromPath(pathname): string | null`
  - `<PublicCoach handle />`

- [ ] **Step 1: Failing tests**

`frontend/src/lib/coach-page.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normaliseHandle, validHandle, pageUrl, coachHandleFromPath, BIO_MAX } from './coach-page.js'

describe('coach page handles (the server checks the same rules: app/Coaching/Handle.php)', () => {
  it('reads a handle as Instagram writes it', () => {
    expect(normaliseHandle(' @Sara.Fit ')).toBe('sara.fit')
    expect(normaliseHandle(null)).toBe('')
  })
  it('keeps to 3–30 letters, digits, dots and underscores, no dot at either end or doubled', () => {
    for (const ok of ['sara.fit', 'sa_ra', 'abc', 'a'.repeat(30)]) expect(validHandle(ok)).toBe(true)
    for (const bad of ['ab', 'a'.repeat(31), 'sara-fit', '.sara', 'sara.', 'sa..ra', 'Sara']) expect(validHandle(bad)).toBe(false)
  })
  it('builds the link a coach puts in their bio', () => {
    expect(pageUrl('sara.fit', 'https://coach.fitpal.ma')).toBe('https://coach.fitpal.ma/c/sara.fit')
    expect(BIO_MAX).toBe(160)
  })
  it('recognises the public page path, and nothing else', () => {
    expect(coachHandleFromPath('/c/sara.fit')).toBe('sara.fit')
    expect(coachHandleFromPath('/c/Sara.Fit')).toBe('sara.fit')
    expect(coachHandleFromPath('/clients')).toBe(null)
    expect(coachHandleFromPath('/c/')).toBe(null)
    expect(coachHandleFromPath('/c/a/b')).toBe(null)
  })
})
```

`frontend/src/views/PublicCoach.test.jsx`: copy the harness from `views/coach/billing.test.jsx` lines 1-80 (`vi.mock('../lib/api.js')` with an `api` that answers by path, `createRoot` in happy-dom, `render`, `text`), trimmed to what this screen needs:

```jsx
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let ANSWER = null
vi.mock('../lib/api.js', async orig => ({
  ...(await orig()),
  api: async path => {
    if (path.startsWith('/api/public/coach?h=')) { if (ANSWER instanceof Error) throw ANSWER; return ANSWER }
    throw new Error('unexpected ' + path)
  },
}))
const { default: PublicCoach } = await import('./PublicCoach.jsx')

let container, root
const text = () => container.textContent
const render = async el => {
  await act(async () => { root.render(<MemoryRouter>{el}</MemoryRouter>) })
  await act(async () => {})
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  document.documentElement.dataset.theme = 'dark'
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('a coach\'s public page', () => {
  it('shows the coach, their bio, the way to ask, and WhatsApp when they gave a number', async () => {
    ANSWER = { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: 'Force pour femmes.', whatsapp: '212612345678', theme: 'dark' } }
    await render(<PublicCoach handle="yasmine.fit" />)
    expect(text()).toContain('Yasmine')
    expect(text()).toContain('Force pour femmes.')
    expect(text()).toContain('Ask to join')
    expect(container.querySelector('a[href="https://wa.me/212612345678"]')).toBeTruthy()
    expect(text()).toContain('Coached with FitPal')
  })

  it('wears the coach\'s theme while it is open, and gives the app its own back after', async () => {
    ANSWER = { coach: { name: 'Yasmine', handle: 'yasmine.fit', bio: '', whatsapp: '', theme: 'light' } }
    await render(<PublicCoach handle="yasmine.fit" />)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(container.querySelector('a[href^="https://wa.me"]')).toBe(null)
    act(() => root.unmount()); root = createRoot(container)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('says why there is nothing to show', async () => {
    ANSWER = new Error('This coach is not taking requests right now')
    await render(<PublicCoach handle="yasmine.fit" />)
    expect(text()).toContain('This coach is not taking requests right now')
  })
})
```

`api()` throws an `Error` whose message is the server's sentence, already translated by `lib/server-messages.js`. Check that against `lib/api.js` before relying on it. If it attaches the message differently, adjust the screen and the test together.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement**

`frontend/src/lib/coach-page.js`:

```js
// A coach's public page (CHW-330): the handle in coach.fitpal.ma/c/<handle>, read and checked
// exactly as the server does (backend/app/Coaching/Handle.php) so the editor can say what is wrong
// before a round trip. The server decides; this only saves a refusal.

export const BIO_MAX = 160

/** As a coach types their Instagram name: a leading @ and capitals dropped. */
export const normaliseHandle = s => (typeof s === 'string' ? s.trim().replace(/^@+/, '').toLowerCase() : '')

export const validHandle = h => /^[a-z0-9._]{3,30}$/.test(h) && !h.startsWith('.') && !h.endsWith('.') && !h.includes('..')

/** The link for the bio. */
export const pageUrl = (handle, origin = location.origin) => `${origin}/c/${handle}`

/** The handle of a public page path (`/c/<handle>`), or null for any other path. */
export function coachHandleFromPath(pathname) {
  const m = /^\/c\/([^/]+)\/?$/.exec(pathname || '')
  return m ? normaliseHandle(decodeURIComponent(m[1])) : null
}
```

`frontend/src/views/PublicCoach.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Logo from '../components/Logo.jsx'
import { Button, Notice } from '../components/ui.jsx'

/**
 * A coach's public page (CHW-330): where the link in their Instagram bio lands, through the server's
 * /c/<handle> (preview tags for the crawlers) and on to here. Anyone may see it, signed in or not.
 * It wears the coach's chosen theme (CHW-323) while open and gives the app its own back after.
 * "Ask to join" leads into the join flow (CHW-336).
 */
export default function PublicCoach({ handle }) {
  const nav = useNavigate()
  const [coach, setCoach] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    api('/api/public/coach?h=' + encodeURIComponent(handle))
      .then(r => { if (live) setCoach(r.coach) })
      .catch(e => { if (live) setError(e.message || t('Could not load this page')) })
    return () => { live = false }
  }, [handle])

  useEffect(() => {
    if (!coach) return
    const de = document.documentElement
    const before = de.dataset.theme
    de.dataset.theme = coach.theme === 'light' ? 'light' : 'dark'
    return () => { de.dataset.theme = before }
  }, [coach?.theme])

  if (error) return <div className="narrow gate">
    <Logo size={30} heading />
    <Notice icon="info" title={error} />
  </div>
  if (!coach) return <div style={{ paddingTop: '42vh', display: 'flex', justifyContent: 'center' }}><Logo size={30} /></div>

  return <div className="narrow gate" style={{ textAlign: 'left' }}>
    <h1 style={{ marginBottom: 6 }}>{coach.name}</h1>
    {coach.bio && <p className="muted" style={{ fontSize: 17, lineHeight: 1.4, marginTop: 0 }}>{coach.bio}</p>}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
      <Button variant="primary" onClick={() => nav('/join/' + coach.handle)}>{t('Ask to join')}</Button>
      {coach.whatsapp && <a className="btn" href={'https://wa.me/' + coach.whatsapp} target="_blank" rel="noopener noreferrer">
        {t('Message on WhatsApp')}</a>}
    </div>
    <div className="dim small" style={{ marginTop: 28, textAlign: 'center' }}>{t('Coached with FitPal')}</div>
  </div>
}
```

Before writing it, confirm two things and adjust:
- that `Notice`'s props are `icon`/`title` (`components/ui.jsx:304`);
- which class makes an `<a>` look like a `Button` (read `Button` at `ui.jsx:479`; use the class it renders, e.g. `btn`).

`App.jsx`, in `Shell`:
- import `PublicCoach` and `coachHandleFromPath`;
- next to `onLink`, add: `const coachPage = coachHandleFromPath(loc.pathname)`;
- in the content expression, render the public page first: `{coachPage ? <PublicCoach handle={coachPage} /> : onLink ? <Link /> : …}`;
- hide the tab bar on it as on `/link`: `{!onLink && !coachPage && (shell === 'coach' ? … )}`;
- keep the boot screen (`(!ready && !authed) || linkPending`) as it is. A signed-out visitor is `!authed` and would see the boot logo until `ready`, which is the same as every signed-out screen today.

Put a comment above `coachPage`: "A coach's public page (CHW-330) is anyone's, signed in or not — before either shell, like /link, with no tab bar."

Strings for all three packs:

| key | fr | es | de |
|---|---|---|---|
| `Ask to join` | `Demander à rejoindre` | `Pedir unirme` | `Beitreten anfragen` |
| `Message on WhatsApp` | `Écrire sur WhatsApp` | `Escribir por WhatsApp` | `Auf WhatsApp schreiben` |
| `Coached with FitPal` | `Coaché avec FitPal` | `Entrenado con FitPal` | `Gecoacht mit FitPal` |
| `Could not load this page` | `Impossible de charger cette page` | `No se pudo cargar esta página` | `Diese Seite konnte nicht geladen werden` |

- [ ] **Step 4: Run them and watch them pass:** `npx vitest run src/lib/coach-page.test.js src/views/PublicCoach.test.jsx && npm run check:i18n`.

- [ ] **Step 5: Commit:** "Coach page: the public screen at /c/<handle>, in the coach's theme (CHW-330)".

---

### Task 5: The editor: Account › My page (`/account/page`)

**Files:**
- Create: `frontend/src/views/coach/PublicPage.jsx` (+ `.test.jsx`)
- Modify: `frontend/src/App.jsx` (`CoachRoutes`: `<Route path="/account/page" element={<PublicPage />} />`), `frontend/src/views/coach/CoachAccount.jsx` (a row in Coaching), packs

**Interfaces:**
- Consumes: `GET /api/coach/page`, `POST /api/coach/page/save` (Task 2); `lib/coach-page.js` (Task 4).
- Produces: the screen.

- [ ] **Step 1: Failing tests**

`frontend/src/views/coach/PublicPage.test.jsx` (same harness; `api` records calls):

```jsx
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let PAGE = { page: null, url: null }
let SAVE = null
vi.mock('../../lib/api.js', async orig => ({
  ...(await orig()),
  api: async (path, opts) => {
    calls.push([path, opts?.body ? JSON.parse(opts.body) : undefined])
    if (path === '/api/coach/page') return PAGE
    if (path === '/api/coach/page/save') { if (SAVE instanceof Error) throw SAVE; return SAVE }
    throw new Error('unexpected ' + path)
  },
}))
const { useUI } = await import('../../store/useUI.js')
const { default: PublicPage } = await import('./PublicPage.jsx')

let container, root
const text = () => container.textContent
const render = async () => {
  await act(async () => { root.render(<MemoryRouter><PublicPage /></MemoryRouter>) })
  await act(async () => {})
}
const type = async (selector, value) => {
  const el = container.querySelector(selector)
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const click = async label => {
  const b = [...container.querySelectorAll('button')].find(x => x.textContent.trim() === label)
  if (!b) throw new Error('no button ' + label + ' in: ' + text())
  await act(async () => { b.click() })
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0; PAGE = { page: null, url: null }; SAVE = null
  useUI.setState({ toasts: [] })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('Account › My page', () => {
  it('starts empty for a coach who has none, and saves what they type, read as the server reads it', async () => {
    SAVE = { page: { handle: 'sara.fit', bio: 'Force.', whatsapp: '212612345678', open: true, theme: 'light' }, url: 'https://coach.example/c/sara.fit' }
    await render()
    await type('input[name="handle"]', '@Sara.Fit')
    await type('textarea[name="bio"]', 'Force.')
    await type('input[name="whatsapp"]', '+212 612 345 678')
    await click('Light')
    await click('Save')
    expect(calls.find(([p]) => p === '/api/coach/page/save')[1]).toEqual({ handle: 'sara.fit', bio: 'Force.', whatsapp: '+212 612 345 678', open: false, theme: 'light' })
    expect(text()).toContain('https://coach.example/c/sara.fit')
  })

  it('loads the page the coach has, and counts the bio', async () => {
    PAGE = { page: { handle: 'sara.fit', bio: 'Force.', whatsapp: '', open: true, theme: 'dark' }, url: 'https://coach.example/c/sara.fit' }
    await render()
    expect(container.querySelector('input[name="handle"]').value).toBe('sara.fit')
    expect(text()).toContain('6 / 160')
  })

  it('says what is wrong with a handle before asking the server', async () => {
    await render()
    await type('input[name="handle"]', 'sa')
    await click('Save')
    expect(calls.find(([p]) => p === '/api/coach/page/save')).toBe(undefined)
    expect(text()).toContain('3–30 letters, numbers, dots or underscores')
  })

  it('shows the server\'s refusal', async () => {
    SAVE = new Error('That handle is taken')
    await render()
    await type('input[name="handle"]', 'sara.fit')
    await click('Save')
    expect(text()).toContain('That handle is taken')
  })
})
```

Notes for these tests:
- The toast state shape: read `store/useUI.js` for how `toast()` stores messages and reset that in `beforeEach`.
- If the screen shows errors inline rather than as a toast, the `text()` assertions already cover it.
- The `open: false` in the first test is the default for a new page; the switch is not touched.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement** `frontend/src/views/coach/PublicPage.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { BIO_MAX, normaliseHandle, validHandle } from '../../lib/coach-page.js'
import { t } from '../../lib/i18n.js'
import { Button, Row, Section, Segmented, Switch, TextArea, TextField } from '../../components/ui.jsx'

/**
 * Account › My page (CHW-330): the coach's public page — the one link in their Instagram bio. The
 * handle is checked here as the server checks it (lib/coach-page.js), so most slips never leave
 * the phone; the server's refusal ("that handle is taken") is shown as it comes.
 */
export default function PublicPage() {
  const nav = useNavigate()
  const [loaded, setLoaded] = useState(false)
  const [url, setUrl] = useState(null)
  const [form, setForm] = useState({ handle: '', bio: '', whatsapp: '', open: false, theme: 'dark' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setError(null) }

  useEffect(() => {
    api('/api/coach/page').then(r => {
      if (r.page) setForm(r.page)
      setUrl(r.url); setLoaded(true)
    }).catch(e => { setError(e.message); setLoaded(true) })
  }, [])

  const save = async () => {
    const handle = normaliseHandle(form.handle)
    if (!validHandle(handle)) { setError(t('Handles are 3–30 letters, numbers, dots or underscores')); return }
    setBusy(true)
    try {
      const r = await api('/api/coach/page/save', { method: 'POST', body: JSON.stringify({ ...form, handle }) })
      setForm(r.page); setUrl(r.url); setError(null)
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  if (!loaded) return null
  return <div className="narrow">
    <div className="hdr"><div style={{ flex: 1 }}><h1 style={{ margin: 0 }}>{t('My page')}</h1>
      <div className="sub">{t('The one link for your Instagram bio.')}</div></div></div>

    <Section title={t('Your link')} footer={url ? url : t('Pick a handle — your Instagram name works.')}>
      <div style={{ padding: '10px 16px' }}>
        <TextField name="handle" placeholder="sara.fit" autoCapitalize="none" autoCorrect="off" maxLength={31}
          value={form.handle} onChange={e => set('handle', e.target.value)} />
      </div>
      <Row icon="link" iconTint="var(--acc)" title={t('Page open')}
        subtitle={t('Closed, the link says you are not taking requests.')}>
        <Switch checked={form.open} onChange={v => set('open', v)} />
      </Row>
    </Section>

    <Section title={t('About you')} footer={t('{0} / {1}', form.bio.length, BIO_MAX)}>
      <div style={{ padding: '10px 16px' }}>
        <TextArea name="bio" rows={3} maxLength={BIO_MAX} placeholder={t('Who you coach, and how.')}
          value={form.bio} onChange={e => set('bio', e.target.value)} />
      </div>
    </Section>

    <Section title={t('WhatsApp')} footer={t('With the country code, e.g. +212 6… Leave empty to hide the button.')}>
      <div style={{ padding: '10px 16px' }}>
        <TextField name="whatsapp" type="tel" placeholder="+212 6 12 34 56 78" value={form.whatsapp}
          onChange={e => set('whatsapp', e.target.value)} />
      </div>
    </Section>

    <Section title={t('Page theme')}>
      <div style={{ padding: '10px 16px' }}>
        <Segmented options={[{ value: 'dark', icon: 'moon', label: t('Dark') }, { value: 'light', icon: 'sun', label: t('Light') }]}
          value={form.theme} onChange={v => set('theme', v)} />
      </div>
    </Section>

    {error && <div className="small" role="alert" style={{ color: 'var(--red)', margin: '0 4px 12px' }}>{error}</div>}
    <Button variant="primary" onClick={save} disabled={busy}>{t('Save')}</Button>
    {url && form.open && <>
      <div style={{ height: 10 }} />
      <Button icon="link" onClick={() => nav('/c/' + form.handle)}>{t('See my page')}</Button>
    </>}
  </div>
}
```

Before writing it, check three things:
- `TextField`/`TextArea` (`ui.jsx:56,60`) pass `name`/`onChange` through to the native element.
- The `Switch` signature (`ui.jsx:80`: `checked`, `onChange(bool)`?).
- Whether `'{0} / {1}'`, `'Dark'`, `'Light'`, `'Save'` and `'WhatsApp'` already exist as keys (`grep -n "'Save'\|'{0} / {1}'" frontend/src/locales/fr.js`). Reuse what exists.

`CoachAccount.jsx`: add this as the first row of the "Coaching" section:

```jsx
      <Row icon="link" iconTint="var(--acc)" title={t('My page')}
        subtitle={t('The one link for your Instagram bio.')} accessory="chevron"
        onClick={() => nav('/account/page')} />
```

Then change the "Invite a client" row's icon to `person` so the two rows differ, and check `person` is in `ICON_NAMES` (`components/Icon.jsx`).

Strings for all three packs. Only add the ones the grep shows are missing:

| key | fr | es | de |
|---|---|---|---|
| `My page` | `Ma page` | `Mi página` | `Meine Seite` |
| `The one link for your Instagram bio.` | `Le lien unique pour votre bio Instagram.` | `El único enlace para tu bio de Instagram.` | `Der eine Link für deine Instagram-Bio.` |
| `Your link` | `Votre lien` | `Tu enlace` | `Dein Link` |
| `Pick a handle — your Instagram name works.` | `Choisissez un identifiant — votre nom Instagram convient.` | `Elige un usuario — tu nombre de Instagram sirve.` | `Wähle einen Namen — dein Instagram-Name passt.` |
| `Page open` | `Page ouverte` | `Página abierta` | `Seite offen` |
| `Closed, the link says you are not taking requests.` | `Fermée, le lien indique que vous ne prenez pas de demandes.` | `Cerrada, el enlace dice que no aceptas solicitudes.` | `Geschlossen, sagt der Link, dass du keine Anfragen annimmst.` |
| `About you` | `À propos de vous` | `Sobre ti` | `Über dich` |
| `Who you coach, and how.` | `Qui vous coachez, et comment.` | `A quién entrenas, y cómo.` | `Wen du coachst, und wie.` |
| `With the country code, e.g. +212 6… Leave empty to hide the button.` | `Avec l’indicatif du pays, ex. +212 6… Laissez vide pour masquer le bouton.` | `Con el prefijo del país, p. ej. +212 6… Déjalo vacío para ocultar el botón.` | `Mit Ländervorwahl, z. B. +212 6… Leer lassen, um den Button auszublenden.` |
| `Page theme` | `Thème de la page` | `Tema de la página` | `Design der Seite` |
| `See my page` | `Voir ma page` | `Ver mi página` | `Meine Seite ansehen` |
| `Handles are 3–30 letters, numbers, dots or underscores` | `Un identifiant fait 3 à 30 lettres, chiffres, points ou tirets bas` | `Un usuario tiene de 3 a 30 letras, números, puntos o guiones bajos` | `Ein Name hat 3–30 Buchstaben, Ziffern, Punkte oder Unterstriche` |

- [ ] **Step 4: Run them and watch them pass:** `npx vitest run src/views/coach/PublicPage.test.jsx && npm run check:i18n && npm test`.

- [ ] **Step 5: Commit:** "Coach page: Account › My page, the editor (CHW-330)".

---

### Task 6: Docs, the full checks, and the photo follow-up

- [ ] **Step 1: `docs/DEPLOY_COACH_SUBDOMAIN.md`.** Add a section "The coach page short link (CHW-330)". The docroot `.htaccess` is the server's (excluded from rsync), so the owner adds this rule once, above the app's SPA fallback rule:

```apache
# A coach's public page: coach.fitpal.ma/c/<handle> is served by the API (preview tags, then the app).
RewriteRule ^c/([A-Za-z0-9._]{3,30})/?$ /api/c/$1 [L,NC]
```

Then check it:

```bash
curl -sI https://coach.fitpal.ma/c/<a real handle> | head -1                     # 200
curl -s https://coach.fitpal.ma/c/<handle> | grep og:title
curl -sA facebookexternalhit/1.1 https://coach.fitpal.ma/c/<handle> | grep og:title   # Cloudflare lets the crawler through
```

Read the file first, and put the section where the other docroot/`.htaccess` notes are.

- [ ] **Step 2: `docs/API.md`.** Add the four routes in that file's format: `GET /api/coach/page`, `POST /api/coach/page/save`, `GET /api/public/coach?h=`, `GET /api/c/{handle}`.

- [ ] **Step 3: Everything CI runs:**

```bash
cd backend && OPENSSL_CONF='C:\xampp\php\extras\ssl\openssl.cnf' php vendor/bin/pest && php vendor/bin/pint --test && node scripts/check-error-strings.mjs && node scripts/check-audit-labels.mjs
cd ../frontend && npm test && npm run check:i18n && npm run build
```

- [ ] **Step 4: Commit** the docs. Then create a Linear issue in milestone C2, labels `backend`, `frontend`: "Coach profile photo: upload, and use it on the public page and its link preview". It follows the progress-photo pipeline, `og:image` uses the photo, and it is related to CHW-330/CHW-324.
