angular.module("app").controller("TrainingController", TrainingController);

function TrainingController(
  $scope,
  $rootScope,
  $interval,
  $http,
  Rasa_Status,
  Agent,
  AgentRegex,
  ExpressionParameters,
  Rasa_Config,
  IntentExpressions,
  yaml,
  AgentEntities,
  AgentActions,
  AgentSynonyms,
  SynonymsVariants,
  appConfig
) {
  let exportData;
  let statuscheck = $interval(getRasaStatus, 5000);
  $scope.generateError = "";
  $scope.toLowercase = false;
  $scope.message = "";

  getRasaStatus();

  $scope.$on("$destroy", function() {
    $interval.cancel(statuscheck);
  });

  Agent.query(function(data) {
    $scope.agentList = data;
  });

  $scope.train = function() {
    let agentname = objectFindByKey(
      $scope.agentList,
      "agent_id",
      $scope.agent.agent_id
    ).agent_name;
    let id = new XDate().toString("yyyyMMdd-HHmmss");
    reset();

    $http
      .post(
        appConfig.api_endpoint_v2 +
          "/rasa/train?name=" +
          agentname +
          "_" +
          id +
          "&project=" +
          agentname,
        JSON.stringify(exportData)
      )
      .then(
        function(response) {
          $scope.message =
            "Training for " + agentname + " completed successfully";
          $rootScope.trainings_under_this_process = 0;
        },
        function(errorResponse) {
          $scope.generateError = JSON.stringify(errorResponse.data.errorBody);
          $rootScope.trainings_under_this_process = 0;
        }
      );
  };

  $scope.savetofile = function() {
    let data = new Blob([JSON.stringify($scope.exportdata, null, 2)], {
      type: "text/plain"
    });
    let a = document.getElementById("a");
    a.download = "trainingdata.json";
    a.href = URL.createObjectURL(data);
    a.click();
  };

  $scope.savecoretofiles = function() {
    let data = new Blob([$scope.domain_yml], { type: "text/plain" });
    let core_domain = document.getElementById("core_domain");
    core_domain.download = "_domain.yml";
    core_domain.href = URL.createObjectURL(data);
    core_domain.click();

    let stories_data = new Blob([$scope.stories_md], { type: "text/plain" });
    let core_stories = document.getElementById("core_stories");
    core_stories.download = "_stories.md";
    core_stories.href = URL.createObjectURL(stories_data);
    core_stories.click();
  };
  $scope.convertToLowerCase = function() {
    $scope.exportdata = JSON.parse(
      JSON.stringify($scope.exportdata).toLowerCase()
    );
  };

  function reset() {
    $scope.toLowercase = false;
    $scope.generateError = "";
    $scope.message = "";
  }

  $scope.getData = function(agent_id) {
    $scope.selectedAgent = objectFindByKey(
      $scope.agentList,
      "agent_id",
      agent_id
    );

    reset();

    Agent.query(
      { agent_id: agent_id, path: "intents" },
      function(intents) {
        //Fetch rasa core data only if its enabled
        if ($scope.selectedAgent.rasa_core_enabled === true)
          populateCoreDomainYaml(agent_id, intents);
        AgentRegex.query({ agent_id: agent_id }, function(regex) {
          AgentSynonyms.query({ agent_id: agent_id }, function(synonyms) {
            let intentIds = intents
              .map(function(item) {
                return item["intent_id"];
              })
              .toString();
            if (intentIds.length > 0) {
              IntentExpressions.query(
                { intent_ids: intentIds },
                function(expressions) {
                  let expressionIds = expressions
                    .map(function(item) {
                      return item["expression_id"];
                    })
                    .toString();
                  if (expressionIds.length > 0) {
                    ExpressionParameters.query(
                      { expression_ids: expressionIds },
                      function(params) {
                        let synonymsIds = synonyms.map(function(item) {
                          return item["synonym_id"];
                        });
                        if (synonymsIds.length > 0) {
                          SynonymsVariants.query(
                            { synonyms_id: synonymsIds },
                            function(variants) {
                              generateData(
                                regex,
                                intents,
                                expressions,
                                params,
                                synonyms,
                                variants
                              );
                            },
                            function(error) {
                              $scope.generateError = error;
                              $scope.exportdata = undefined;
                            }
                          );
                        } else {
                          generateData(regex, intents, expressions, params);
                        }
                      },
                      function(error) {
                        $scope.generateError = error;
                        $scope.exportdata = undefined;
                      }
                    );
                  } else {
                    generateData(regex, intents, expressions);
                  }
                },
                function(error) {
                  $scope.generateError = error;
                  $scope.exportdata = undefined;
                }
              );
            } else {
              $scope.generateError =
                "At least one intent is required to train a model";
              $scope.exportdata = undefined;
            }
          });
        });
      },
      function(error) {
        $scope.generateError = error;
        $scope.exportdata = undefined;
      }
    );
  };

  function populateCoreDomainYaml(agent_id, intents) {
    //get entities by agentid
    let domain_yml_obj = {};
    $scope.stories_md = "";
    Agent.get({ agent_id: agent_id }, function(data) {
      $scope.stories_md = data.story_details;
    });

    AgentEntities.query({ agent_id: agent_id }, function(allEntities) {
      let requiredSlots = allEntities.filter(
        entity =>
          entity.slot_data_type != "NOT_USED" && entity.slot_data_type != ""
      );
      if (requiredSlots.length > 0) {
        //build slots
        let slots_yml_str = requiredSlots
          .map(function(slot) {
            return (
              '"' +
              slot["entity_name"] +
              '":{"type":"' +
              slot["slot_data_type"] +
              '"}'
            );
          })
          .join(",");
        domain_yml_obj.slots = JSON.parse("{" + slots_yml_str + "}");
      }

      if (intents.length > 0) {
        //build intents
        domain_yml_obj.intents = intents.map(function(intent) {
          return intent["intent_name"];
        });
      }

      if (allEntities.length > 0) {
        //build entities
        domain_yml_obj.entities = allEntities.map(function(entity) {
          return entity["entity_name"];
        });
      }
      domain_yml_obj.action_factory = "remote";

      AgentActions.query({ agent_id: agent_id }, function(actionsList) {
        if (actionsList != null && actionsList.length > 0) {
          //build actions
          domain_yml_obj.actions = actionsList.map(function(action) {
            return action["action_name"];
          });

          let action_ids = actionsList
            .map(function(action) {
              return action["action_id"];
            })
            .toString();

          $http({
            method: "GET",
            url:
              appConfig.api_endpoint_v2 +
              "/action_responses?action_ids=" +
              action_ids
          }).then(
            function(data) {
              if (data.data.length > 0) {
                let responsesArrObj = {};
                data.data.map(function(response) {
                  let response_templete = {};
                  if (!responsesArrObj.hasOwnProperty(response.action_name)) {
                    responsesArrObj[response.action_name] = [];
                  }
                  //add response text if there is one
                  if (
                    response.response_text != null &&
                    response.response_text !== ""
                  ) {
                    response_templete.text = response.response_text;
                  }
                  //add buttons if there are any
                  if (
                    response.buttons_info != null &&
                    response.buttons_info !== ""
                  ) {
                    response_templete.buttons = response.buttons_info.map(
                      function(button) {
                        let buttonObj = {};
                        buttonObj.title = button.title;
                        buttonObj.payload = button.payload;
                        return buttonObj;
                      }
                    );
                  }
                  //add image if it is available.
                  if (
                    response.response_image_url != null &&
                    response.response_image_url !== ""
                  ) {
                    response_templete.image = response.response_image_url;
                  }
                  responsesArrObj[response.action_name].push(response_templete);
                });
                domain_yml_obj.templates = responsesArrObj;
              }
              //build templetes
              try {
                if (!angular.equals(domain_yml_obj, {}))
                  $scope.domain_yml = yaml.stringify(domain_yml_obj);
              } catch (e) {}
            },
            function() {}
          );
        }
      });
    });
  }

  function generateData(
    regex,
    intents,
    expressions,
    params,
    synonyms,
    variants
  ) {
    let tmpData = {};
    let tmpIntent = {};
    let tmpExpression = {};
    let tmpParam = {};
    tmpData.rasa_nlu_data = {};
    tmpData.rasa_nlu_data.common_examples = [];
    if (typeof synonyms !== "undefined") {
      tmpData.rasa_nlu_data.entity_synonyms = [];
      for (let synonym_i = 0; synonym_i < synonyms.length; synonym_i++) {
        let variants_synonyme = variants
          .filter(function(obj) {
            return obj.synonym_id === synonyms[synonym_i].synonym_id;
          })
          .map(function(obj) {
            return obj.synonym_value;
          });
        if (variants_synonyme.length !== 0) {
          tmpData.rasa_nlu_data.entity_synonyms.push({
            value: synonyms[synonym_i].synonym_reference,
            synonyms: variants_synonyme
          });
        }
      }
    }
    if (regex.length > 0) {
      tmpData.rasa_nlu_data.regex_features = [];
    }

    for (let regex_i = 0; regex_i < regex.length; regex_i++) {
      tmpData.rasa_nlu_data.regex_features.push({
        name: regex[regex_i].regex_name,
        pattern: regex[regex_i].regex_pattern
      });
    }

    for (let intent_i = 0; intent_i <= intents.length - 1; intent_i++) {
      let expressionList = expressions.filter(
        expression => expression.intent_id === intents[intent_i].intent_id
      );
      if (expressionList !== undefined) {
        for (
          let expression_i = 0;
          expression_i <= expressionList.length - 1;
          expression_i++
        ) {
          tmpIntent = {};
          tmpExpression = {};

          tmpIntent.text = expressionList[expression_i].expression_text;
          tmpIntent.intent = intents[intent_i].intent_name;

          tmpIntent.entities = [];
          tmpIntent.expression_id = expressionList[expression_i].expression_id;

          let parameterList = params.filter(
            param =>
              param.expression_id === expressionList[expression_i].expression_id
          );
          if (parameterList !== undefined) {
            for (
              let parameter_i = 0;
              parameter_i <= parameterList.length - 1;
              parameter_i++
            ) {
              tmpParam = {};
              tmpParam.start = parameterList[parameter_i].parameter_start;
              tmpParam.end = parameterList[parameter_i].parameter_end;
              tmpParam.value = parameterList[parameter_i].parameter_value;
              tmpParam.entity = parameterList[parameter_i].entity_name;
              tmpIntent.entities.push(tmpParam);

              //Check for common errors
              if (tmpParam.entity === null) {
                $scope.generateError = "Entity is null";
              }
            }
            tmpData.rasa_nlu_data.common_examples.push(tmpIntent);
          }
        }
      }
    }

    for (
      let i = 0;
      i <= tmpData.rasa_nlu_data.common_examples.length - 1;
      i++
    ) {
      let parameterList = params.filter(
        param =>
          param.expression_id ===
          tmpData.rasa_nlu_data.common_examples[i].expression_id
      );
      if (
        tmpData.rasa_nlu_data.common_examples[i].entities.length !==
        parameterList.length
      ) {
        let missingEntities = parameterList.filter(
          param =>
            param.entity_id !==
            tmpData.rasa_nlu_data.common_examples[i].entities[0].entity_id
        );
        for (
          let parameter_i = 0;
          parameter_i <= missingEntities.length - 1;
          parameter_i++
        ) {
          tmpParam = {};
          let start = tmpData.rasa_nlu_data.common_examples[i].text.indexOf(
            missingEntities[parameter_i].parameter_value
          );
          let end = missingEntities[parameter_i].parameter_value.length + start;
          tmpParam.start = start;
          tmpParam.end = end;
          tmpParam.value = missingEntities[parameter_i].parameter_value;
          tmpParam.entity = missingEntities[parameter_i].entity_name;
          tmpData.rasa_nlu_data.common_examples[i].entities.push(tmpParam);
        }
      }
      delete tmpData.rasa_nlu_data.common_examples[i].expression_id;
    }

    exportData = tmpData;
    $scope.exportdata = tmpData;
    $scope.generateError = "";
  }

  function getRasaStatus() {
    Rasa_Status.get(function(statusdata) {
      Rasa_Config.get(function(configdata) {
        try {
          $rootScope.config = configdata.toJSON();
          $rootScope.config.isonline = 1;
          $rootScope.config.server_model_dirs_array = getAvailableModels(
            statusdata
          );
          if ($rootScope.config.server_model_dirs_array.length > 0) {
            $rootScope.modelname =
              $rootScope.config.server_model_dirs_array[0].name;
          } else {
            $rootScope.modelname = "Default";
          }

          if (
            statusdata !== undefined ||
            statusdata.available_models !== undefined
          ) {
            $rootScope.available_models = sortArrayByDate(
              getAvailableModels(statusdata),
              "xdate"
            );
            $rootScope.trainings_under_this_process = getNoOfTrainingJobs(
              statusdata
            );
          }
        } catch (err) {}
      });
    });
  }
}
