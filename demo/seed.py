"""Create or update the synthetic rollout used by the disposable CI demo."""

import os

from django.db import transaction
from environments.models import Environment
from features.models import Feature, FeatureSegment, FeatureState
from flag_engine.segments.constants import EQUAL
from organisations.models import Organisation
from projects.models import Project
from segments.models import Condition, Segment, SegmentRule


@transaction.atomic
def configure_demo(stage):
    organisation, _ = Organisation.objects.get_or_create(name="Flag Contract Demo")
    project, _ = Project.objects.get_or_create(
        organisation=organisation, name="Search rollout"
    )
    environment, _ = Environment.objects.get_or_create(
        project=project,
        name="Demo",
        defaults={"hide_disabled_flags": False, "allow_client_traits": True},
    )
    feature, _ = Feature.objects.get_or_create(
        project=project,
        name="search_v2",
        defaults={"default_enabled": False, "initial_value": "standard"},
    )
    segment, _ = Segment.objects.get_or_create(project=project, name="Beta search")
    rule, _ = SegmentRule.objects.get_or_create(
        segment=segment, type=SegmentRule.ANY_RULE
    )
    Condition.objects.get_or_create(rule=rule, operator=EQUAL, property="plan", value="beta")
    if stage == "regression":
        Condition.objects.get_or_create(rule=rule, operator=EQUAL, property="plan", value="free")
    elif stage == "restored":
        Condition.objects.filter(rule=rule, operator=EQUAL, property="plan", value="free").delete()

    override, _ = FeatureSegment.objects.get_or_create(
        feature=feature, environment=environment, segment=segment
    )
    state, _ = FeatureState.objects.get_or_create(
        feature=feature,
        environment=environment,
        feature_segment=override,
        defaults={"enabled": True},
    )
    value = state.feature_state_value
    value.string_value = "hybrid"
    value.save()
    print(f"DEMO_ENVIRONMENT_KEY={environment.api_key}")


stage = os.environ["DEMO_STAGE"]
if stage not in {"baseline", "regression", "restored"}:
    raise ValueError(f"Unknown demo stage: {stage}")
configure_demo(stage)
