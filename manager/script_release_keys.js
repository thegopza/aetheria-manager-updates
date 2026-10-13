'use strict';
// PmheeAether PUBLIC production trust pins only. Signing secrets stay in the private API.
// Never load production pins from a ticket, API response or editable local configuration.
module.exports = Object.freeze({
  'aetheria-production-candidate-1': Object.freeze({
    kty: 'EC', crv: 'P-256',
    x: 'hnw6uquRstktKVuOxVv2dZfK3aljo4-SfHw6FAJbd9g',
    y: '4ZzL-RjnS0UIdvHUdcnU4xrmFiNs1TAqNM_sscCWd68'
  })
});
