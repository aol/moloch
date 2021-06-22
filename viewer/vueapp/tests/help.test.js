import Vue from 'vue';
// eslint-disable-next-line no-shadow
import $ from 'jquery';
import { render, fireEvent } from '@testing-library/vue';
import Help from '../src/components/help/Help.vue';
import FieldService from '../src/components/search/FieldService';
import HasPermission from '../src/components/utils/HasPermission.vue';
const { fields } = require('./consts');

global.$ = global.jQuery = $;

Vue.directive('has-permission', HasPermission);

jest.mock('../src/components/search/FieldService');

test('help page field list', async () => {
  FieldService.get = jest.fn().mockResolvedValue(fields);

  const $route = { path: 'http://localhost:8123/arkime/help#fields' };

  const { getByText, queryByText } = render(Help, {
    mocks: { $route }
  });

  expect(queryByText('Database Field')).toBeNull();

  await fireEvent.click(getByText('Display Database Fields'));

  getByText('Database Field');
});
