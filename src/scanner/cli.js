const
    _ = require('lodash'),
    kefir = require('kefir'),
    Table = require('cli-table'),
    Kubemote = require('../kubemote');
    const util  = require('util');

const argumentParsers = [
    (str)=> ((match)=> match && { includeContainers: _.get(match, '3') !== "0" })(str.match(/^(-c|--containers?)(=([01]))?$/)),
    (str)=> ((match)=> match && { deploymentName: _.get(match, '0', '') })(str.match(/^\w+$/))
];



let timeConverter = (date)=>{

  const MIL_IN_SEC = 1000;
  const MIL_IN_MIN = 60*MIL_IN_SEC;
  const MIL_IN_HOUR = 60*MIL_IN_MIN;
  const MIL_IN_DAY =  24 * MIL_IN_HOUR;

   let time = {};
     let factors = [MIL_IN_DAY, MIL_IN_HOUR, MIL_IN_MIN, MIL_IN_SEC];
     let letter = ["d", "h", "m", "s"]

     factors.reduce((agg, factor)=>{
       console.log(`factor:${factor}`);
        _.set(agg.time, letter[agg.index],~~(agg.rest/factor));
        agg.rest = agg.rest%factor;
        agg.index++;
        return agg;
      }, {time, index:0, rest:date})

     /*time.d = (~~(date/MIL_IN_DAY));
     let rest =   date%MIL_IN_DAY;
     time.h = (~~(current/MIL_IN_HOUR));
     rest =  current%MIL_IN_HOUR
     time.m = (~~(current/MIL_IN_MIN));
     rest = current%MIL_IN_MIN;
     time.s = (~~(current/MIL_IN_SEC));
     rest =  current%MIL_IN_SEC;
     _flow(()=>)*/

     time = _.pickBy(time, _.identity);
     let ret =  _.map(time, (v, k)=>v + `${k}:`)
     .slice(0, _.values(time).length).join('');

     return _.trimEnd(ret, ":");
}
const generateDeploymentsConsoleReport = function({ deploymentName = "", includeContainers = false }){

    let client = new Kubemote();
    return kefir
        .fromPromise(client.getDeployments()).map()
         .log('deploy->').flatMap((res)=> {
            //console.log(`name ${_.get(res, 'metadata.name')}`);
            return kefir.combine(
                (res["kind"] === "Deployment" ? [res] : res["items"])
                    .filter((deploymentName &&_.matchesProperty('metadata.name', deploymentName)) || _.constant(true))
                    .map((deploymentDoc)=>{
                        return kefir.combine([
                            kefir.constant({ deploy: deploymentDoc }),
                            includeContainers ?
                                kefir
                                    .fromPromise(client.getPods(_.get(deploymentDoc, 'spec.selector.matchLabels')))
                                    .map(({ items: podDocs })=>({ containers: _(podDocs).map('status.containerStatuses').flatten().value() })) :
                                kefir.constant({})
                        ], _.merge)
                    })
            );
        }).log('->')
        .map((report)=>{
            console.log('adding report');
            let table = new Table({ head: _.compact([ "Name", "Desired", "Current", "Available", "Age", includeContainers && "Images(s)", "Selectors" ]) });
            report.forEach((item)=>{
                let [name, replicas, updatedReplicas, unavailableReplicas, creationTimestamp, containers, labels] = _.zipWith(_.at(item, [
                    "deploy.metadata.name",
                    "deploy.status.replicas",
                    "deploy.status.updatedReplicas",
                    "deploy.status.unavailableReplicas",
                    "deploy.metadata.creationTimestamp",
                    "containers",
                    "deploy.metadata.labels"
                ]), [
                    _.identity,
                    _.toInteger,
                    _.toInteger,
                    _.toInteger,
                    Date.parse,
                    _.identity,
                    _.identity,
                ], (v, f)=> f(v));
                console.log(`container : ${util.format(containers)}`);
                table.push([
                    name,
                    replicas,
                    updatedReplicas,
                    replicas - unavailableReplicas,
                    timeConverter(Date.now() - creationTimestamp),
                    ...(includeContainers ? [containers.map(({ image })=> _.truncate(image, { length: 50 })).join('\n')] : []),
                    _.truncate(_.map(labels, (v,k)=> `${k}=${v}`).join(' '), { length: 50 })
                ]);
            });

            return table.toString();
        })
        .mapErrors(({ message = "Unspecified" })=> message).log()
        .toPromise();
};
console.log(process
    .argv);
generateDeploymentsConsoleReport(
    process
        .argv
        .slice(2)
        .reduce((ac, arg)=> _.assign(ac, argumentParsers.map((parser)=> parser(arg) || {}).reduce(_.merge)), {})
    )
    .then(console.info)
    .catch(console.error);
