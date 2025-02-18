# isort: skip_file
# pylint: disable=unused-variable


def scope_define_instance():
    # start_define_instance
    from dagster_fivetran import fivetran_resource

    # Pull API key and secret from environment variables
    fivetran_instance = fivetran_resource.configured(
        {
            "api_key": {"env": "FIVETRAN_API_KEY"},
            "api_secret": {"env": "FIVETRAN_API_SECRET"},
        }
    )
    # end_define_instance


def scope_load_assets_from_fivetran_instance():
    from dagster_fivetran import fivetran_resource

    fivetran_instance = fivetran_resource.configured(
        {
            "api_key": {"env": "FIVETRAN_API_KEY"},
            "api_secret": {"env": "FIVETRAN_API_SECRET"},
        }
    )
    # start_load_assets_from_fivetran_instance
    from dagster_fivetran import load_assets_from_fivetran_instance

    # Use the fivetran_instance resource we defined in Step 1
    fivetran_assets = load_assets_from_fivetran_instance(fivetran_instance)
    # end_load_assets_from_fivetran_instance


def scope_manually_define_fivetran_assets():
    # start_manually_define_fivetran_assets
    from dagster_fivetran import build_fivetran_assets

    fivetran_assets = build_fivetran_assets(
        connector_id="omit_constitutional",
        destination_tables=["public.survey_responses", "public.surveys"],
    )
    # end_manually_define_fivetran_assets


def scope_fivetran_manual_config():
    from dagster_fivetran import fivetran_resource

    fivetran_instance = fivetran_resource.configured(
        {
            "api_key": {"env": "FIVETRAN_API_KEY"},
            "api_secret": {"env": "FIVETRAN_API_SECRET"},
        }
    )
    # start_fivetran_manual_config
    from dagster_fivetran import build_fivetran_assets

    from dagster import with_resources

    fivetran_assets = with_resources(
        build_fivetran_assets(
            connector_id="omit_constitutional",
            destination_tables=["public.survey_responses", "public.surveys"],
        ),
        # Use the fivetran_instance resource we defined in Step 1
        {"fivetran": fivetran_instance},
    )
    # end_fivetran_manual_config


def scope_schedule_assets():
    fivetran_assets = []
    # start_schedule_assets
    from dagster import ScheduleDefinition, define_asset_job, repository, AssetSelection

    # materialize all assets in the repository
    run_everything_job = define_asset_job("run_everything", selection="*")

    # only run my_fivetran_connection and downstream assets
    my_etl_job = define_asset_job(
        "my_etl_job", AssetSelection.groups("my_fivetran_connection").downstream()
    )

    @repository
    def my_repo():
        return [
            fivetran_assets,
            ScheduleDefinition(
                job=my_etl_job,
                cron_schedule="@daily",
            ),
            ScheduleDefinition(
                job=run_everything_job,
                cron_schedule="@weekly",
            ),
        ]

    # end_schedule_assets
