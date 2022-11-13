from .decorators import repository
from contextlib import contextmanager
import inspect
import sys
from typing import List, Union, Mapping, Any
from .assets import AssetsDefinition, SourceAsset
from .schedule_definition import ScheduleDefinition
from .resource_definition import ResourceDefinition
from .sensor_definition import SensorDefinition
from .job_definition import JobDefinition
from .repository_definition import RepositoryDefinition
from dagster._core.execution.with_resources import with_resources

MAGIC_REPO_GLOBAL_KEY = "__dagster_repository"

# invoke this function to get the module name the function that called the current
# scope
def get_module_name_of_caller() -> str:
    # based on https://stackoverflow.com/questions/2000861/retrieve-module-object-from-stack-frame
    # two f_backs to get past get_module_name_of_caller frame
    return inspect.currentframe().f_back.f_back.f_globals["__name__"]


def get_python_env_global_dagster_repository() -> RepositoryDefinition:
    parent_module_name = get_module_name_of_caller()
    return sys.modules[parent_module_name].__dict__[MAGIC_REPO_GLOBAL_KEY]


@contextmanager
def definitions_test_scope(dundername):
    parent_mod = sys.modules[dundername]
    assert MAGIC_REPO_GLOBAL_KEY not in parent_mod.__dict__
    try:
        yield
    finally:
        if MAGIC_REPO_GLOBAL_KEY in parent_mod.__dict__:
            del parent_mod.__dict__[MAGIC_REPO_GLOBAL_KEY]


class DefinitionsAlreadyCalledError(Exception):
    pass


def definitions(
    *,
    assets: List[Union[AssetsDefinition, SourceAsset]] = None,
    schedules: List[ScheduleDefinition] = None,
    sensors: List[SensorDefinition] = None,
    jobs: List[JobDefinition] = None,
    resources: Mapping[str, Any] = None,
) -> None:

    module_name = get_module_name_of_caller()
    mod = sys.modules[module_name]

    if MAGIC_REPO_GLOBAL_KEY in mod.__dict__:
        raise DefinitionsAlreadyCalledError()

    # total hack job for now for test cases
    # This is likely fairly fragile, but if the module
    # name 
    if "." in module_name:
        repo_name = module_name.split(".")[-1]
    else:
        repo_name = module_name

    # TODO enforce global uniqueness

    resource_defs = coerce_resources_to_defs(resources or {})

    # in this case where this is invoked by the raw python interpreter
    # (rather than through dagster CLI or dagit)
    # the name can be "__main__"
    @repository(name=repo_name)
    def global_repo():
        return (
            with_resources(assets or [], resource_defs)
            + (schedules or [])
            + (sensors or [])
            + (jobs or [])
        )

    mod.__dict__[MAGIC_REPO_GLOBAL_KEY] = global_repo


def coerce_resources_to_defs(resources: Mapping[str, Any]) -> Mapping[str, ResourceDefinition]:
    resource_defs = {}
    for key, resource_obj in resources.items():
        resource_defs[key] = (
            resource_obj
            if isinstance(resource_obj, ResourceDefinition)
            else ResourceDefinition.hardcoded_resource(resource_obj)
        )
    return resource_defs