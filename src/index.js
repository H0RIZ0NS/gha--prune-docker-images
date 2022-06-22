import * as core from '@actions/core'
import * as github from '@actions/github'
import { config as dotenv } from 'dotenv'

const CONTAINER_PACKAGE_TYPE = 'container'

let log = (message) => {
  core.info(message)
}

let handleError = (error) => {
  core.setFailed(error)
}

let loadDotenv = (environment) => {
  if (environment && environment !== 'production') {
    log('Loading the dotenv file…')

    dotenv()
  }
}

let getRepo = (client, repoFullName) => {
  log(`Fetching the \`${repoFullName}\` repository…`)

  const [REPO_OWNER, REPO_NAME] = repoFullName.split('/')

  return (
    client.repos
      .get({
        owner: REPO_OWNER,
        repo: REPO_NAME,
      })
      .then((response) => response.data)
  )
}

let getRepoPackages = (client, repo) => {
  let selectRepoPackages = (pkg) => pkg.repository.full_name === repo.full_name

  let transformResponse = (response) => (
    response.data.filter(selectRepoPackages)
  )

  log('Fetching the repository’s linked container packages…')

  switch (repo.owner.type) {
    case 'Organization':
      return (
        client.packages
          .listPackagesForOrganization({
            package_type: CONTAINER_PACKAGE_TYPE,
            org: repo.owner.login,
          })
          .then(transformResponse)
      )

    case 'User':
      return (
        client.packages
          .listPackagesForUser({
            package_type: CONTAINER_PACKAGE_TYPE,
            user: repo.owner.login,
          })
          .then(transformResponse)
      )

    default:
      throw 'The repository’s owner type is unknown.'
  }
}

let getUntaggedPackageVersions = (client, packages) => {
  let selectUntaggedVersions = (version) => version.metadata.container.tags.length === 0

  let transformResponse = (response, pkg) => (
    response.data
      .filter(selectUntaggedVersions)
      .map((version) => ({
        ...version,
        package: pkg,
      }))
  )

  let mapPackagesToVersionPromises = (packages) => (
    packages.map((pkg) => {
      switch (pkg.owner.type) {
        case 'Organization':
          return (
            client.packages
              .getAllPackageVersionsForPackageOwnedByOrg({
                package_type: CONTAINER_PACKAGE_TYPE,
                package_name: pkg.name,
                org: pkg.owner.login,
              })
              .then((response) => transformResponse(response, pkg))
          )

        case 'User':
          return (
            client.packages
              .getAllPackageVersionsForPackageOwnedByUser({
                package_type: CONTAINER_PACKAGE_TYPE,
                package_name: pkg.name,
                username: pkg.owner.login,
              })
              .then((response) => transformResponse(response, pkg))
          )

        default:
          throw 'The package’s owner type is unknown.'
      }
    })
  )

  log('Fetching the packages’ untagged versions…')

  return (
    Promise
      .all(mapPackagesToVersionPromises(packages))
      .then((packageVersions) => packageVersions.flat())
  )
}

let deleteVersions = (client, versions) => {
  let transformResponse = (response, version) => version.id

  let mapVersionsToDeletionPromises = (versions) => (
    versions.map((version) => {
      switch (version.package.owner.type) {
        case 'Organization':
          return (
            client.packages
              .deletePackageVersionForOrg({
                package_type: CONTAINER_PACKAGE_TYPE,
                package_name: version.package.name,
                org: version.package.owner.login,
                package_version_id: version.id,
              })
              .then((response) => transformResponse(response, version))
          )

        case 'User':
          return (
            client.packages
              .deletePackageVersionForUser({
                package_type: CONTAINER_PACKAGE_TYPE,
                package_name: version.package.name,
                username: version.package.owner.login,
                package_version_id: version.id,
              })
              .then((response) => transformResponse(response, version))
          )

        default:
          throw 'The version’s owner type is unknown.'
      }
    })
  )

  log('Deleting the packages’ untagged versions…')

  return Promise.all(mapVersionsToDeletionPromises(versions))
}

let finalize = (deletedVersionIds) => {
  log('👍 Success!')

  if (deletedVersionIds.length) {
    log(`The following untagged versions were removed: ${deletedVersionIds.join(', ')}.`)
  } else {
    log('There were no untagged versions to remove.')
  }
}

let main = () => {
  try {
    loadDotenv(process.env.NODE_ENV)

    const REPOSITORY = core.getInput('repository')
    const GH_TOKEN = core.getInput('gh_token')

    core.setSecret(GH_TOKEN)

    const client = github.getOctokit(GH_TOKEN).rest

    Promise
      .resolve(REPOSITORY)
      .then((repoFullName) => getRepo(client, repoFullName))
      .then((repo) => getRepoPackages(client, repo))
      .then((packages) => getUntaggedPackageVersions(client, packages))
      .then((versions) => deleteVersions(client, versions))
      .then(finalize)
      .catch(handleError)
  } catch (error) {
    handleError(error)
  }
}

main()
