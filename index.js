/* jshint node:true */
'use strict';

var rateLimitDown = false;

var Tentacles = require('tentacles');
var tentacles = new Tentacles({
  accessToken: process.env.GITHUB_TOKEN,
  extensions: [
    function(options, callback, next) {
       /* Call the next middleware in the chain */
       next(options, function(err, response, body) {
         var remaining = parseInt(response.headers['x-ratelimit-remaining'], 10);
         if (remaining < 1500) {
           rateLimitDown = true;
         }
         callback(err, response, body);
       });
    }
  ]
});

var Q = require('q');
var qlimit = require('qlimit');
var limit = qlimit(2); // 2 being the maximum concurrency

function getAllForkedRepos(page) {
  console.log('getting page ', page, ' of repos');
  var moreResults = false;

  return tentacles.repo.listForAuthUser({ query: { page: page, per_page: 100, sort: 'pushed', direction: 'desc' } })
    .then(function(repos) {

      moreResults = repos.length > 0;

      return Q.all(repos.map(limit(function(repo) {
        if (!repo.fork) return;

        // Need to get the full repo to get the parent attribute...
        return tentacles.repo.get(repo.full_name)
          .then(function(repo) {
            if (!repo) return; // No idea why this would happen, but ignore

            var parentRepo = repo.parent && repo.parent.full_name;
            if (!parentRepo) return;

            // Find all open pull requests on the parent
            return tentacles.pullRequest.listForRepo(parentRepo, { query: { head: 'gitter-badger:gitter-badge', state: 'open' } })
              .then(function(pulls) {
                if (pulls.length) return console.log('Will not delete ' + repo.full_name); // Open pull. Leave it..

                console.log('Deleting ' + repo.full_name);
                return tentacles.repo.delete(repo.full_name);
              });

          });

      })));

    })
    .then(function() {
      if (rateLimitDown) {
        console.log('Stopping for now as rate limit is running out...');
        return;
      }
      if (moreResults) {
        return getAllForkedRepos(page + 1);
      }
    });
}

getAllForkedRepos(1)
      .done();
