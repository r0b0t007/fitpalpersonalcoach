<?php

namespace App\Console\Commands;

use App\Models\LoginLink;
use App\Models\User;
use Illuminate\Console\Command;

/**
 * The owner's sign-in for the admin panel (/admin-panel): an email and a password on the EXISTING
 * admin account. Filament's make:filament-user would create a new account instead — and this
 * table's ids are the 16-character strings the Node API minted, which it cannot make. The
 * password is asked for, never taken as an argument (it would sit in the shell's history), and is
 * the only password any account has: everyone else signs in with a passkey.
 */
final class PanelLogin extends Command
{
    protected $signature = 'fitpal:panel-login {id : the admin account\'s id}';

    protected $description = 'Set the email and password the owner signs in to the admin panel with';

    private const MIN_PASSWORD = 12;

    public function handle(): int
    {
        $user = User::query()->find((string) $this->argument('id'));
        if ($user === null || ! $user->isAdmin()) {
            $this->error('no admin account with that id — the panel is for admins only');

            return self::FAILURE;
        }
        $email = LoginLink::normaliseEmail((string) $this->ask('Email', $user->email));
        if (! LoginLink::validEmail($email)) {
            $this->error('that is not an email address');

            return self::FAILURE;
        }
        if (User::query()->whereKeyNot($user->id)->where('email', $email)->exists()) {
            $this->error('another account signs in with that address');

            return self::FAILURE;
        }
        $password = (string) $this->secret('Password (at least '.self::MIN_PASSWORD.' characters)');
        if (mb_strlen($password) < self::MIN_PASSWORD) {
            $this->error('too short');

            return self::FAILURE;
        }
        if ($password !== (string) $this->secret('The same again')) {
            $this->error('the two did not match');

            return self::FAILURE;
        }
        $user->forceFill(['email' => $email, 'password' => $password])->save();
        $this->info("{$user->name} signs in to /admin-panel as {$email}.");

        return self::SUCCESS;
    }
}
