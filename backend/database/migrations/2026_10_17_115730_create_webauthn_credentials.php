<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Laragear\WebAuthn\Models\WebAuthnCredential;

// Accounts have string ids (16 characters, as the Node API minted them), so the morph column must
// be a string too; 'uuid' is the package's string option and char(36) holds them.
Schema::defaultMorphKeyType('uuid');

return WebAuthnCredential::migration()->with(function (Blueprint $table) {
    // The COSE bytes a credential had in the Node API's db.json, kept beside the PEM the package
    // uses, so an import can be audited and redone.
    $table->text('legacy_cose')->nullable();
});
