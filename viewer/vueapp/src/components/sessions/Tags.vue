<template>

  <!-- tag sessions form -->
  <div class="row"
    @keyup.stop.prevent.enter="apply(add)">

    <SegmentSelect :segments.sync="segments" />

    <div class="col-md-5">

      <!-- tags input -->
      <div class="input-group input-group-sm">
        <div class="input-group-prepend">
          <span class="input-group-text">
            Tags
          </span>
        </div>
        <input v-model="tags"
          v-focus-input="true"
          type="text"
          class="form-control"
          placeholder="Enter a comma separated list of tags"
        />
      </div> <!-- /tags input -->

      <!-- error -->
      <p v-if="error"
        class="small text-danger mb-0">
        <span class="fa fa-exclamation-triangle">
        </span>&nbsp;
        {{ error }}
      </p> <!-- /error -->

    </div>

    <!-- buttons -->
    <div class="col-md-3">
      <div class="pull-right">
        <button class="btn btn-sm btn-theme-tertiary"
          v-if="add"
          @click="apply(true)"
          :class="{'disabled':loading}"
          type="button">
          <span v-if="!loading">
            <span class="fa fa-plus-circle">
            </span>&nbsp;
            Add Tags
          </span>
          <span v-else>
            <span class="fa fa-spinner fa-spin">
            </span>&nbsp;
            Adding Tags
          </span>
        </button>
        <button class="btn btn-sm btn-danger"
          v-else
          @click="apply(false)"
          :class="{'disabled':loading}"
          type="button">
          <span v-if="!loading">
            <span class="fa fa-trash-o">
            </span>&nbsp;
            Remove Tags
          </span>
          <span v-else>
            <span class="fa fa-spinner fa-spin">
            </span>&nbsp;
            Removing Tags
          </span>
        </button>
        <button class="btn btn-sm btn-warning"
          v-b-tooltip.hover
          title="cancel"
          @click="done(null)"
          type="button">
          <span class="fa fa-ban">
          </span>
        </button>
      </div>
    </div> <!-- /buttons -->

  </div> <!-- /tag sessions form -->

</template>

<script>
import FocusInput from '../utils/FocusInput';
import SessionsService from './SessionsService';
import SegmentSelect from './SegmentSelect';

export default {
  name: 'MolochTagSessions',
  directives: { FocusInput },
  components: { SegmentSelect },
  props: {
    add: Boolean,
    start: Number,
    done: Function,
    single: Boolean,
    applyTo: String,
    sessions: Array,
    numVisible: Number,
    numMatching: Number
  },
  data: function () {
    return {
      error: '',
      loading: false,
      segments: 'no',
      tags: ''
    };
  },
  methods: {
    /* exposed functions ----------------------------------------- */
    apply: function (addTags) {
      if (!this.tags) {
        this.error = 'No tag(s) specified.';
        return;
      }

      this.loading = true;

      const data = {
        tags: this.tags,
        start: this.start,
        applyTo: this.applyTo,
        segments: this.segments,
        sessions: this.sessions,
        numVisible: this.numVisible,
        numMatching: this.numMatching
      };

      SessionsService.tag(addTags, data, this.$route.query)
        .then((response) => {
          this.tags = '';
          this.loading = false;
          this.done(response.data.text, response.data.success, this.single);
        })
        .catch((error) => {
          // display the error under the form so that user
          // has an opportunity to try again (don't close the form)
          this.error = error.text;
          this.loading = false;
        });
    }
  }
};
</script>
