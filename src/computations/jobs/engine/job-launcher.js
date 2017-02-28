import {JobRestartException} from "./exceptions/job-restart-exception";
import {JOB_STATUS} from "./job-status";
import * as log from "../../../log";
import {Utils} from "../../../utils";
import {JobParametersInvalidException} from "./exceptions/job-parameters-invalid-exception";
import {JobDataInvalidException} from "./exceptions/job-data-invalid-exception";

export class JobLauncher {

    jobRepository;
    jobWorker;

    constructor(jobRepository, jobWorker, dataModelSerializer) {
        this.jobRepository = jobRepository;
        this.jobWorker = jobWorker;
        this.dataModelSerializer = dataModelSerializer;
    }


    run(jobOrName, jobParametersValues, data, resolvePromiseAfterJobIsLaunched = true) {
        var job;
        var jobParameters;

        return Promise.resolve().then(()=> {
            if (Utils.isString(jobOrName)) {
                job = this.jobRepository.getJobByName(jobOrName)
            } else {
                job = jobOrName;
            }
            if (!job) {
                throw new JobRestartException("No such job: " + jobOrName);
            }

            jobParameters = job.createJobParameters(jobParametersValues);

            return this.validate(job, jobParameters, data);
        }).then(valid=>{

            if(this.jobWorker){
                log.debug("Job: [" + job.name + "] execution delegated to worker");
                return this.jobWorker.runJob(job.name, jobParametersValues, this.dataModelSerializer(data))
            }

            return this.jobRepository.createJobExecution(job.name, jobParameters, data).then(jobExecution=>{
                var executionPromise = this.execute(job, jobExecution);
                if(resolvePromiseAfterJobIsLaunched){
                    return jobExecution;
                }
                return executionPromise;
            })
        })
    }

    validate(job, jobParameters, data){
        return this.jobRepository.getLastJobExecution(job.name, jobParameters).then(lastExecution=>{
            if (lastExecution != null) {
                if (!job.isRestartable) {
                    throw new JobRestartException("JobInstance already exists and is not restartable");
                }

                lastExecution.stepExecutions.forEach(execution=> {
                    if (execution.status == JOB_STATUS.UNKNOWN) {
                        throw new JobRestartException("Step [" + execution.stepName + "] is of status UNKNOWN");
                    }
                });
            }
            if (job.jobParametersValidator && !job.jobParametersValidator.validate(jobParameters)) {
                throw new JobParametersInvalidException("Invalid job parameters in jobLauncher.run for job: "+job.name)
            }

            if(job.jobDataValidator && !job.jobDataValidator.validate(data)){
                throw new JobDataInvalidException("Invalid job data in jobLauncher.run for job: "+job.name)
            }

            return true;
        })
    }

    execute(job, jobExecution){
        var jobName = job.name;
        log.info("Job: [" + jobName + "] launched with the following parameters: [" + jobExecution.jobParameters + "]");
        return job.execute(jobExecution).then(jobExecution=>{
            log.info("Job: [" + jobName + "] completed with the following parameters: [" + jobExecution.jobParameters + "] and the following status: [" + jobExecution.status + "]");
            return jobExecution;
        }).catch(e =>{
            log.error("Job: [" + jobName + "] failed unexpectedly and fatally with the following parameters: [" + jobExecution.jobParameters + "]", e);
            throw e;
        })
    }
}
