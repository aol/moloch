'use strict';

import Vue from 'vue';
import axios from 'axios';
import VueAxios from 'vue-axios';
import BootstrapVue from 'bootstrap-vue';
// eslint-disable-next-line no-shadow
import $ from 'jquery';
import '@testing-library/jest-dom';
import { render, fireEvent, waitFor } from '@testing-library/vue';
import Search from '../src/components/search/Search.vue';
import UserService from '../src/components/users/UserService';
import ConfigService from '../src/components/utils/ConfigService';
import HasPermission from '../src/components/utils/HasPermission.vue';
import SessionsService from '../src/components/sessions/SessionsService';
const { userWithSettings, fields, views } = require('./consts');

global.$ = global.jQuery = $;

Vue.use(VueAxios, axios);
Vue.use(BootstrapVue);
Vue.directive('has-permission', HasPermission);

Vue.prototype.$constants = {
  MOLOCH_HUNTWARN: 10000,
  MOLOCH_HUNTLIMIT: 1000000,
  MOLOCH_ANONYMOUS_MODE: false
};

jest.mock('../src/components/users/UserService');
jest.mock('../src/components/utils/ConfigService');
jest.mock('../src/components/sessions/SessionsService');

const store = {
  state: {
    user: userWithSettings,
    expression: '',
    issueSearch: false,
    shiftKeyHold: false,
    views: views,
    timeRange: -1,
    time: { startTime: 0, stopTime: 0 },
    esCluster: {
      availableCluster: {
        active: [],
        inactive: []
      },
      selectedCluster: []
    }
  },
  mutations: {
    setAvailableCluster: jest.fn(),
    setSelectedCluster: jest.fn(),
    setFocusSearch: jest.fn(),
    setViews: jest.fn(),
    setTimeRange: jest.fn(),
    setExpression: jest.fn(),
    deleteViews: jest.fn()
  }
};

beforeEach(() => {
  ConfigService.getMolochClusters = jest.fn().mockResolvedValue({
    test2: { name: 'Test2', url: 'http://localhost:8124' }
  });
  ConfigService.getClusters = jest.fn().mockResolvedValue({
    data: { active: [], inactive: [] }
  });
  UserService.getViews = jest.fn().mockResolvedValue(views);
  UserService.deleteView = jest.fn().mockResolvedValue({
    success: true, text: 'yay!'
  });
  UserService.getState = jest.fn().mockResolvedValue({ data: {} });
  SessionsService.tag = jest.fn().mockResolvedValue({
    data: { text: 'did it!', success: true }
  });
});

test("search bar doesn't have actions button", async () => {
  const $route = { query: {}, name: 'Spiview' };

  const {
    queryByTitle
  } = render(Search, {
    store,
    mocks: { $route },
    props: { openSessions: [], fields: fields }
  });

  // actions menu is only available on the sessions page
  expect(queryByTitle('Actions menu')).not.toBeInTheDocument();
});

test('search bar', async () => {
  const $route = { query: {}, name: 'Sessions' };

  const {
    getByText, getAllByText, getByTitle, getByPlaceholderText
  } = render(Search, {
    store,
    mocks: { $route },
    props: { openSessions: [], fields: fields }
  });

  getByText('Search'); // component rendered, search button is visible

  // forms display --------------------------------------------------------- //
  await fireEvent.click(getByTitle('Export PCAP'));
  expect(getAllByText('Export PCAP').length).toBe(2);

  await fireEvent.click(getByTitle('Export CSV'));
  expect(getAllByText('Export CSV').length).toBe(2);

  await fireEvent.click(getByTitle('Remove Data'));
  expect(getAllByText('Remove Data').length).toBe(2);

  await waitFor(() => { // need to wait for getMolochClusters to return
    fireEvent.click(getByTitle('Send to Test2')); // displays clusters
  });
  getByText('Send Session(s)');

  await fireEvent.click(getByTitle('Export Intersection'));
  expect(getAllByText('Export Intersection').length).toBe(2);

  await fireEvent.click(getByTitle('Add Tags'));
  expect(getAllByText('Add Tags').length).toBe(2);

  await fireEvent.click(getByTitle('Remove Tags'));
  expect(getAllByText('Remove Tags').length).toBe(2);

  // form closes  ---------------------------------------------------------- //
  await fireEvent.update(getByPlaceholderText('Enter a comma separated list of tags'), 'tag1,tag2');
  await fireEvent.click(getAllByText('Remove Tags')[1]);
  await waitFor(() => {
    getByText('did it!'); // displays message from server
    expect(getAllByText('Remove Tags').length).toBe(1);
  });

  // views ----------------------------------------------------------------- //
  await waitFor(() => {
    getByText('test view 1'); // view is displayed
  });

  await fireEvent.click(getByTitle('Create a new view'));
  getByText('Create View'); // view form can be opened

  await fireEvent.click(getByTitle('Delete this view.'));
  expect(UserService.deleteView).toHaveBeenCalledTimes(1); // view can be deleted
});
