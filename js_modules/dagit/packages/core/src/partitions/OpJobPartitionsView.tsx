import {gql, useQuery} from '@apollo/client';
import {Box, Button, Dialog, Icon, Tooltip, Colors, Subheading} from '@dagster-io/ui';
import * as React from 'react';

import {usePermissions} from '../app/Permissions';
import {PYTHON_ERROR_FRAGMENT} from '../app/PythonErrorInfo';
import {useViewport} from '../gantt/useViewport';
import {Loading} from '../ui/Loading';
import {repoAddressToSelector} from '../workspace/repoAddressToSelector';
import {RepoAddress} from '../workspace/types';

import {BackfillPartitionSelector} from './BackfillSelector';
import {JobBackfillsTable} from './JobBackfillsTable';
import {PartitionGraph} from './PartitionGraph';
import {PartitionState, PartitionStatus, runStatusToPartitionState} from './PartitionStatus';
import {getVisibleItemCount, PartitionPerOpStatus} from './PartitionStepStatus';
import {GRID_FLOATING_CONTAINER_WIDTH} from './RunMatrixUtils';
import {
  PartitionsStatusQuery_partitionSetOrError_PartitionSet_partitionStatusesOrError_PartitionStatuses_results,
  PartitionsStatusQuery_partitionSetOrError_PartitionSet,
  PartitionsStatusQuery,
  PartitionsStatusQueryVariables,
} from './types/PartitionsStatusQuery';
import {usePartitionStepQuery} from './usePartitionStepQuery';

type PartitionStatus = PartitionsStatusQuery_partitionSetOrError_PartitionSet_partitionStatusesOrError_PartitionStatuses_results;

export const OpJobPartitionsView: React.FC<{
  partitionSetName: string;
  repoAddress: RepoAddress;
}> = ({partitionSetName, repoAddress}) => {
  const repositorySelector = repoAddressToSelector(repoAddress);
  const queryResult = useQuery<PartitionsStatusQuery, PartitionsStatusQueryVariables>(
    PARTITIONS_STATUS_QUERY,
    {variables: {partitionSetName, repositorySelector}},
  );

  return (
    <Loading queryResult={queryResult}>
      {({partitionSetOrError}) => {
        if (
          partitionSetOrError.__typename !== 'PartitionSet' ||
          partitionSetOrError.partitionsOrError.__typename !== 'Partitions'
        ) {
          return null;
        }

        const partitionNames = partitionSetOrError.partitionsOrError.results.map(({name}) => name);

        return (
          <OpJobPartitionsViewContent
            partitionNames={partitionNames}
            partitionSet={partitionSetOrError}
            repoAddress={repoAddress}
          />
        );
      }}
    </Loading>
  );
};

const OpJobPartitionsViewContent: React.FC<{
  partitionNames: string[];
  partitionSet: PartitionsStatusQuery_partitionSetOrError_PartitionSet;
  repoAddress: RepoAddress;
}> = ({partitionSet, partitionNames, repoAddress}) => {
  const {canLaunchPartitionBackfill} = usePermissions();
  const {viewport, containerProps} = useViewport();

  const [pageSize, setPageSize] = React.useState(60);
  const [offset, setOffset] = React.useState<number>(0);
  const [showSteps, setShowSteps] = React.useState(false);
  const [showBackfillSetup, setShowBackfillSetup] = React.useState(false);
  const [blockDialog, setBlockDialog] = React.useState(false);
  const repositorySelector = repoAddressToSelector(repoAddress);
  const [backfillRefetchCounter, setBackfillRefetchCounter] = React.useState(0);

  const partitions = usePartitionStepQuery(
    partitionSet.name,
    partitionNames,
    pageSize,
    [],
    partitionSet.pipelineName,
    offset,
    !showSteps,
  );

  React.useEffect(() => {
    if (viewport.width && !showSteps) {
      // magical numbers to approximate the size of the window, which is calculated in the step
      // status component.  This approximation is to make sure that the window does not jump as
      // the pageSize gets recalculated
      const approxPageSize = getVisibleItemCount(viewport.width - GRID_FLOATING_CONTAINER_WIDTH);
      setPageSize(approxPageSize);
    }
  }, [viewport.width, showSteps, setPageSize]);

  const selectedPartitions = showSteps
    ? partitionNames.slice(
        Math.max(0, partitionNames.length - 1 - offset - pageSize),
        partitionNames.length - offset,
      )
    : partitionNames;

  const runDurationData: {[name: string]: number | undefined} = {};

  const stepDurationData: {[name: string]: {[key: string]: (number | undefined)[]}} = {};
  partitions.forEach((p) => {
    if (!p.runsLoaded || p.runs.length === 0) {
      return;
    }
    const lastRun = p.runs[p.runs.length - 1];
    stepDurationData[p.name] = {};
    lastRun.stepStats.forEach((s) => {
      stepDurationData[p.name][s.stepKey] = [
        s.endTime && s.startTime ? s.endTime - s.startTime : undefined,
      ];
    });
  });
  const statusData: {[name: string]: PartitionState} = {};
  (partitionSet.partitionStatusesOrError.__typename === 'PartitionStatuses'
    ? partitionSet.partitionStatusesOrError.results
    : []
  ).forEach((p) => {
    statusData[p.partitionName] = runStatusToPartitionState(p.runStatus);
    if (selectedPartitions.includes(p.partitionName)) {
      runDurationData[p.partitionName] = p.runDuration || undefined;
    }
  });

  const onSubmit = React.useCallback(() => setBlockDialog(true), []);

  return (
    <div>
      <Dialog
        canEscapeKeyClose={!blockDialog}
        canOutsideClickClose={!blockDialog}
        onClose={() => setShowBackfillSetup(false)}
        style={{width: 800, zIndex: 1000}}
        title={`Launch ${partitionSet.pipelineName} backfill`}
        isOpen={showBackfillSetup}
      >
        {showBackfillSetup && (
          <BackfillPartitionSelector
            partitionSetName={partitionSet.name}
            partitionNames={partitionNames}
            partitionData={statusData}
            pipelineName={partitionSet.pipelineName}
            onCancel={() => setShowBackfillSetup(false)}
            onLaunch={(_backfillId, _stepQuery) => {
              setBackfillRefetchCounter(backfillRefetchCounter + 1);
              setShowBackfillSetup(false);
            }}
            onSubmit={onSubmit}
            repoAddress={repoAddress}
          />
        )}
      </Dialog>

      <Box
        flex={{justifyContent: 'space-between', direction: 'row', alignItems: 'center'}}
        border={{width: 1, side: 'bottom', color: Colors.KeylineGray}}
        padding={{vertical: 16, horizontal: 24}}
      >
        <Subheading>Status</Subheading>
        <Box flex={{gap: 8}}>
          <Button onClick={() => setShowSteps(!showSteps)} active={showBackfillSetup}>
            {showSteps ? 'Hide per-step status' : 'Show per-step status'}
          </Button>
          {canLaunchPartitionBackfill.enabled ? (
            <Button
              onClick={() => setShowBackfillSetup(!showBackfillSetup)}
              icon={<Icon name="add_circle" />}
              active={showBackfillSetup}
            >
              Launch backfill...
            </Button>
          ) : (
            <Tooltip content={canLaunchPartitionBackfill.disabledReason}>
              <Button icon={<Icon name="add_circle" />} disabled>
                Launch backfill...
              </Button>
            </Tooltip>
          )}
        </Box>
      </Box>
      <Box
        flex={{direction: 'row', alignItems: 'center'}}
        border={{width: 1, side: 'bottom', color: Colors.KeylineGray}}
        padding={{left: 8}}
      >
        <CountBox count={partitionNames.length} label="Total partitions" />
        <CountBox
          count={partitionNames.filter((x) => statusData[x] === PartitionState.FAILURE).length}
          label="Failed partitions"
        />
        <CountBox
          count={partitionNames.filter((x) => !statusData[x]).length}
          label="Missing partitions"
        />
      </Box>
      <Box padding={{vertical: 16, horizontal: 24}}>
        <div {...containerProps}>
          <PartitionStatus
            partitionNames={partitionNames}
            partitionStateForKey={(name) => statusData[name]}
            selected={showSteps ? selectedPartitions : undefined}
            selectionWindowSize={pageSize}
            onClick={(partitionName) => {
              const maxIdx = partitionNames.length - 1;
              const selectedIdx = partitionNames.indexOf(partitionName);
              const nextOffset = Math.min(
                maxIdx,
                Math.max(0, maxIdx - selectedIdx - 0.5 * pageSize),
              );
              setOffset(nextOffset);
              if (!showSteps) {
                setShowSteps(true);
              }
            }}
            tooltipMessage="Click to view per-step status"
          />
        </div>
        {showSteps ? (
          <Box margin={{top: 16}}>
            <PartitionPerOpStatus
              partitionNames={partitionNames}
              partitions={partitions}
              pipelineName={partitionSet.pipelineName}
              repoAddress={repoAddress}
              setPageSize={setPageSize}
              offset={offset}
              setOffset={setOffset}
            />
          </Box>
        ) : null}
      </Box>
      <Box
        padding={{horizontal: 24, vertical: 16}}
        border={{side: 'horizontal', width: 1, color: Colors.KeylineGray}}
      >
        <Subheading>Run duration</Subheading>
      </Box>
      <Box margin={24}>
        <PartitionGraph
          isJob={true}
          title="Execution time by partition"
          yLabel="Execution time (secs)"
          partitionNames={showSteps ? selectedPartitions : partitionNames}
          jobDataByPartition={runDurationData}
        />
      </Box>
      {showSteps ? (
        <>
          <Box padding={{horizontal: 24, vertical: 16}}>
            <Subheading>Step duration</Subheading>
          </Box>
          <Box margin={24}>
            <PartitionGraph
              isJob={true}
              title="Execution time by partition"
              yLabel="Execution time (secs)"
              partitionNames={selectedPartitions}
              stepDataByPartition={stepDurationData}
            />
          </Box>
        </>
      ) : null}
      <Box
        padding={{horizontal: 24, vertical: 16}}
        border={{side: 'horizontal', color: Colors.KeylineGray, width: 1}}
        style={{marginBottom: -1}}
      >
        <Subheading>Backfill history</Subheading>
      </Box>
      <Box margin={{bottom: 20}}>
        <JobBackfillsTable
          partitionSetName={partitionSet.name}
          repositorySelector={repositorySelector}
          partitionNames={partitionNames}
          refetchCounter={backfillRefetchCounter}
        />
      </Box>
    </div>
  );
};

export const CountBox: React.FC<{
  count: number;
  label: string;
}> = ({count, label}) => (
  <Box padding={16} style={{flex: 1}} border={{side: 'right', width: 1, color: Colors.KeylineGray}}>
    <div style={{fontSize: 18, marginBottom: 4}}>
      <strong>{count}</strong>
    </div>
    <div>{label}</div>
  </Box>
);

const PARTITIONS_STATUS_QUERY = gql`
  query PartitionsStatusQuery(
    $partitionSetName: String!
    $repositorySelector: RepositorySelector!
  ) {
    partitionSetOrError(
      repositorySelector: $repositorySelector
      partitionSetName: $partitionSetName
    ) {
      ... on PartitionSet {
        id
        name
        pipelineName
        partitionsOrError {
          ... on Partitions {
            results {
              name
            }
          }
        }
        partitionStatusesOrError {
          __typename
          ... on PartitionStatuses {
            results {
              id
              partitionName
              runStatus
              runDuration
            }
          }
          ...PythonErrorFragment
        }
      }
    }
  }

  ${PYTHON_ERROR_FRAGMENT}
`;
