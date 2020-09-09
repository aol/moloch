import Vue from 'vue';

export default {
  getSources: function () {
    return new Promise((resolve, reject) => {
      Vue.axios.get('sources')
        .then((response) => {
          resolve(response.data);
        })
        .catch((error) => {
          console.log('service error', error);
          reject(error);
        });
    });
  },
  getTypes: function (source) {
    return new Promise((resolve, reject) => {
      let url = source ? 'types/' + source : 'types';
      Vue.axios.get(url)
        .then((response) => {
          resolve(response.data);
        })
        .catch((error) => {
          console.log('service error', error);
          reject(error);
        });
    });
  },
  getResourceStats: function () {
    return new Promise((resolve, reject) => {
      Vue.axios.get('stats')
        .then((response) => {
          resolve(response.data);
        })
        .catch((error) => {
          console.log('service error', error);
          reject(error);
        });
    });
  },
  getConfigDefs: function () {
    return new Promise((resolve, reject) => {
      Vue.axios.get('configDefs')
        .then((response) => {
          resolve(response.data);
        })
        .catch((error) => {
          console.log('service error', error);
          reject(error);
        });
    });
  },
  getCurrConfig: function () {
    return new Promise((resolve, reject) => {
      Vue.axios.get('config/get')
        .then((response) => {
          resolve(response.data);
        })
        .catch((error) => {
          console.log('service error', error);
          reject(error);
        });
    });
  },
  getSourceFiles: function () {
    return new Promise((resolve, reject) => {
      Vue.axios.get('/sources/files/get')
        .then((response) => {
          resolve(response.data);
        })
        .catch((error) => {
          console.log('service error', error);
          reject(error);
        });
    });
  },
  saveSourceFile: function (sourceName, data) {
    // TODO: new file saving
    return new Promise((resolve, reject) => {
      Vue.axios.put('/source/' + sourceName + '/save', { raw: data })
        .then((response) => {
          resolve(response.data);
        })
        .catch((error) => {
          reject(error);
        });
    });
  },
  saveCurrConfig: function (config) {
    return new Promise((resolve, reject) => {
      Vue.axios.put('config/save', { config: config })
        .then((response) => {
          resolve(response.data);
        })
        .catch((error) => {
          reject(error.response.data);
        });
    });
  },
  search: function (source, type, value) {
    return new Promise((resolve, reject) => {
      let url = ((source ? source.replace(':', '%3A') + '/' : '') + type + '/' + value);
      Vue.axios.get(url)
        .then((response) => {
          resolve(response.data);
        })
        .catch((error) => {
          console.log('service error', error);
          reject(error);
        });
    });
  }
};
