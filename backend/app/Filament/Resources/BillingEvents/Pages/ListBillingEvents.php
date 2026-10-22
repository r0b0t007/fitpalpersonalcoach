<?php

namespace App\Filament\Resources\BillingEvents\Pages;

use App\Filament\Resources\BillingEvents\BillingEventResource;
use Filament\Resources\Pages\ListRecords;

class ListBillingEvents extends ListRecords
{
    protected static string $resource = BillingEventResource::class;
}
