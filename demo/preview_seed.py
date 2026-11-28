"""Apply the checked-in candidate to two environments on the disposable demo instance."""
import json
import os

from django.db import transaction
from environments.models import Environment
from features.models import Feature, FeatureSegment, FeatureState
from flag_engine.segments.constants import EQUAL
from organisations.models import Organisation
from projects.models import Project
from segments.models import Condition, Segment, SegmentRule

with transaction.atomic():
    plan = json.loads(os.environ["ROLLOUT_PLAN"])
    if not isinstance(plan, dict) or set(plan) != {"staging", "production"}:
        raise ValueError("Provide staging and production plan lists")
    org, _ = Organisation.objects.get_or_create(name="Flag Contract Demo")
    project, _ = Project.objects.get_or_create(organisation=org, name="Catalog preview")
    flag, _ = Feature.objects.get_or_create(project=project, name="AMP_enable-kotlin-server-source",
                                           defaults={"default_enabled": False})
    for name, plans in plan.items():
        if not isinstance(plans, list) or any(p not in ("free", "beta") for p in plans) or len(plans) != len(set(plans)):
            raise ValueError("Each rollout is a list of unique free or beta plan values")
        env, _ = Environment.objects.get_or_create(project=project, name=name,
                                                  defaults={"allow_client_traits": True, "hide_disabled_flags": False})
        segment, _ = Segment.objects.get_or_create(project=project, name=name + " Kotlin rollout")
        rule, _ = SegmentRule.objects.get_or_create(segment=segment, type=SegmentRule.ANY_RULE)
        Condition.objects.filter(rule=rule).delete()
        for value in plans:
            Condition.objects.create(rule=rule, operator=EQUAL, property="plan", value=value)
        override, _ = FeatureSegment.objects.get_or_create(feature=flag, environment=env, segment=segment)
        FeatureState.objects.update_or_create(feature=flag, environment=env, feature_segment=override,
                                             defaults={"enabled": bool(plans)})
        print(f"{name.upper()}_KEY={env.api_key}")
