import { Button, Checkbox, Flex, Grid, NumberInput, Select, TextInput } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconCircleMinus, IconEdit, IconTrash } from "@tabler/icons-react";
import * as z from "zod";
import { DESTRUCTION } from "dns";
import { curry, sortBy } from "lodash";
import { Fragment, useEffect, useReducer, useState } from "react";
import { tw } from "twind";
import { useImmer, useImmerReducer } from "use-immer";
import { v1 as uuidv1, v4 as uuidv4 } from "uuid"
import If from "../../components/If";
import AppLayout from "../../components/Layout";
import { FieldType, InputType } from "../../types/Inputs";
import { FreeTextInput, OptionsInput } from "./new-form";
import axios from "axios";

const HIKMA_API = process.env.NEXT_PUBLIC_HIKMA_API;

const inputTypes = ["number", "text", "select", "date"] as const

type DefaultLanguages = {
  en: string;
  ar?: string;
  es?: string;
}

type TranslationObject = DefaultLanguages & {
  [lang: string]: string
}

type LanguageKey = "en" | "ar" | "es" | string;

type RegistrationFormField = {
  id: string,
  position: number;
  // column name in the database
  column: string;
  label: TranslationObject,
  fieldType: typeof inputTypes[number],
  options: TranslationObject[]
  required: boolean;
  baseField: boolean; // whether or not this is part of the base inputs required of all registration forms
  visible: boolean; // Whether or not it displays in the app
}

type RegistrationForm = {
  id: string,
  name: string,
  fields: RegistrationFormField[],
  metadata: Record<string, any>,
  createdAt: Date;
  updatedAt: Date;
}

const registrationFormFieldSchema = z.object({
  id: z.string().min(1),
  position: z.number().min(1),
  column: z.string().min(1),
  label: z.record(z.string().min(0)),
  fieldType: z.enum(inputTypes),
  options: z.array(z.record(z.string().min(1))),
  required: z.boolean(),
  baseField: z.boolean(),
  visible: z.boolean(),
});

const registrationFormSchema = z.object({
  id: z.string().min(10),
  fields: z.array(registrationFormFieldSchema),
  metadata: z.any(),
  createdAt: z.date(),
  updatedAt: z.date(),
});


/**
Given a translation object, create options for a dropdown

@param {TranslationObject[]} translations
@param {LanguageKey} language
@returns {Array<{label: string, value: string}>}
*/
function translationObjectOptions(translations: TranslationObject[], language: LanguageKey): Array<{ label: string; value: string; }> {
  return translations.map(t => getTranslation(t, language)).map(st => ({
    label: st,
    value: st
  }))
}

type FormField = RegistrationForm["fields"][number]


/**
Base fields are required for all user registration fields
  
THESE FIELDS ARE SEARCHABLE BY DEFAULT
First Name, Last Name, date of birth, sex, registration date
*/
const baseFields: RegistrationForm["fields"] = [
  {
    baseField: true,
    id: "e3d7615c-6ee6-11ee-b962-0242ac120002",
    column: "given_name",
    position: 1,
    label: {
      en: "First Name",
      es: "Nombre",
      ar: "الاسم المعطى"
    },
    fieldType: "text",
    options: [],
    visible: true,
    required: true,
  },
  {
    baseField: true,
    id: "128faebe-6ee7-11ee-b962-0242ac120002",
    column: "surname",
    position: 2,
    label: {
      en: "Last Name",
      ar: "الكنية",
      es: "Apellido"
    },
    fieldType: "text",
    options: [],
    visible: true,
    required: true,
  },
  {
    baseField: true,
    id: "417d5df8-6eeb-11ee-b962-0242ac120002",
    column: "date_of_birth",
    position: 3,
    label: {
      en: "Date of Birth",
      ar: "تاريخ الولادة",
      es: "Fecha de nacimiento"
    },
    fieldType: "date",
    options: [],
    visible: true,
    required: true,
  },
  {
    baseField: true,
    id: "4b9190de-6eeb-11ee-b962-0242ac120002",
    column: "sex",
    position: 4,
    label: {
      en: "Sex",
      ar: "جنس",
      es: "Sexo"
    },
    fieldType: "select",
    options: [
      {
        en: "male",
        ar: "ذكر",
        es: "masculino"
      },
      {
        en: "female",
        ar: "أنثى",
        es: "femenino"
      }
    ], // only if its a search field
    visible: true,
    required: true,
  },
  {
    baseField: true,
    id: "33282fe0-6f76-11ee-b962-0242ac120002",
    column: "country",
    position: 6,
    label: {
      en: "Country",
      ar: "بلد",
      es: "País"
    },
    fieldType: "text",
    options: [],
    visible: true,
    required: true,
  },
]


type State = RegistrationForm
type Action =
  | { type: "set-form-state", payload: { form: State } } // sets the entire form to a specific value. usefull for initial states and setting values to what is in the database.
  | { type: "add-field" } // generates a fieldID by default
  | { type: "remove-field", payload: { id: string } } // only removes fields that are not base fields
  | { type: "change-position", payload: { id: string; position: number } }
  | { type: "update-field-label", payload: { translation: string; label: string, id: string } }
  | { type: "toggle-field-required", payload: { id: string } }
  | {
    type: "toggle-visibility", payload: {
      id: string
    }
  }
  | {
    type: "update-field-translation", payload: {
      language: string;
      text: string
    }
  }
  | {
    type: "update-field-type", payload: {
      id: string
      type: typeof inputTypes[number]
    }
  }
  | {
    type: "add-select-option", payload: { id: string }
  }
  | {
    type: "remove-select-option", payload: { id: string, index: number }
  }
  | {
    type: "add-select-option-translation", payload: {
      id: string,
      index: number,
      language: LanguageKey
    }
  }
  | {
    type: "remove-select-option-translation", payload: {
      id: string,
      index: number,
      language: LanguageKey
    }
  }
  | {
    type: "update-select-option-translation", payload: {
      id: string,
      index: number,
      language: LanguageKey,
      value: string
    }
  }


function reducer(state: State, action: Action) {
  switch (action.type) {
    case "set-form-state": {
      const { form } = action.payload;
      // due to immutable data structures not triggering the reload, have to set each field
      // manually
      state.name = form.name;
      state.createdAt = form.createdAt;
      state.id = form.id;
      state.updatedAt = form.updatedAt;
      state.metadata = form.metadata

      state.fields = [...form.fields];
      break;
    }
    case "add-field": {
      // do something
      const position = state.fields.length + 1
      const newField: FormField = {
        id: uuidv1(),
        baseField: false,
        fieldType: "text",
        column: "",
        label: {
          en: "New Field " + position,
          es: "Nueva Entrada " + position,
          ar: "مدخلات جديدة"
        },
        options: [],
        position: position,
        required: true,
        visible: true
      }

      state.fields.push(newField)
      break;
    }
    case "update-field-label": {
      const { label, id, translation } = action.payload;
      const field = state.fields.find(f => f.id === id)

      if (field) {
        field.label[translation] = label

        // edit the column name to be the english translation of a field
        if (translation === "en") {
          if (field.label["en"].length > 0) {
            field.column = encodeURI(field.label["en"])
          }
        }


        //update the column name
        // FIXME: Should you be able to update the column name for even base fields?? Probably not!
        // FIXME: Are the column names even needed for the additional fields???
        // field.column = getTranslation(field.label, translation)
      }
      break;
    }
    case "update-field-type": {
      const { id, type } = action.payload;
      const field = state.fields.find(f => f.id === id)

      if (field) {
        const oldFieldType = field.fieldType;
        field.fieldType = type

        // if the new field is of type "select", insert a new starting option in the options field
        if (oldFieldType !== "select" && type === "select") {
          field.options.length === 0 && field.options.push({
            en: "",
          })
        } else if (oldFieldType === "select" && type !== "select") {
          // when you leave the select input type, clear the options to reduce the clutter in the stored form
          field.options = []
        }
      }
      break;
    }
    case "add-select-option": {
      const { id } = action.payload;
      const field = state.fields.find(f => f.id === id)

      if (field && field.fieldType === "select") {
        field.options.push({ en: "" })
      }
      break
    }
    case "remove-select-option": {
      const { id, index } = action.payload;
      const field = state.fields.find(f => f.id === id)

      if (field && field.fieldType === "select") {
        field.options.splice(index, 1)
      }
      break
    }
    case "add-select-option-translation": {
      const { id, index, language } = action.payload;
      const field = state.fields.find(f => f.id === id)

      if (field && field.fieldType === "select") {
        field.options.forEach((field, idx) => {
          if (idx === index) {
            field[language] = ""
          }
        })
      }
      break
    }
    case "remove-select-option-translation": {
      const { id, index, language } = action.payload;
      const field = state.fields.find(f => f.id === id)

      if (field && field.fieldType === "select") {
        field.options.forEach((field, idx) => {
          if (idx === index) {
            delete field[language]
          }
        })
      }
      break
    }
    case "update-select-option-translation": {
      const { id, index, language, value } = action.payload;
      const field = state.fields.find(f => f.id === id)

      if (field && field.fieldType === "select") {
        field.options.forEach((field, idx) => {
          if (idx === index) {
            field[language] = value
          }
        })
      }
      break
    }
    case "remove-field": {
      const { id } = action.payload
      const field = state.fields.find(f => f.id === id)
      // if there is no field, or if the field is a base field
      if (field === undefined || field?.baseField) return

      state.fields = state.fields.filter(field => field.id !== id)

      break;
    }
    case "change-position": {
      const { id, position } = action.payload

      // no position is lower than 0
      if (position <= 0) return

      // no position is greated than the length of the fields
      if (position > state.fields.length) return;

      const field = state.fields.find(f => f.id === id)


      if (field) {
        // sort all the items in order of their position
        const sorted = sortBy(state.fields, ["position"]);

        // array without the moving field
        const remainingSorted = sorted.filter(f => f.id !== id);

        // place the field in the new position
        remainingSorted.splice(position - 1, 0, field);
        state.fields = remainingSorted.map((field, idx) => ({ ...field, position: idx + 1 }))
      }

      break;
    }
    case "toggle-visibility": {
      const { id } = action.payload
      const field = state.fields.find(f => f.id === id)

      if (field) {
        field.visible = !field.visible
      }
      break;
    }
    case "toggle-field-required": {
      const { id } = action.payload
      const field = state.fields.find(f => f.id === id)
      if (field?.baseField) return

      if (field) {
        field.required = !field.required
      }
      break;
    }
  }
}


/**
Call the HTTP endpoint to upsert a form

@param {RegistrationForm} form
*/
function saveForm(form: RegistrationForm) {
  return axios
    .post(
      `${HIKMA_API}/admin_api/update_patient_registration_form`,
      {
        form: {
          ...form,
          fields: JSON.stringify(form.fields),
          metadata: JSON.stringify(form.metadata)
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: String(localStorage.getItem('token')),
        },
      }
    )
}


export default function PatientRegistrationForm() {
  // initial state is either loaded from the DB or on first deployment its loaded from a local state
  const initialState: RegistrationForm = {
    id: "cc9647e0-7915-11ee-b962-0242ac120002",
    // Remove when the migrating to multiple forms support
    name: 'Patient Registration Form',
    fields: baseFields,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  }


  const [formLanguage, setFormLanguage] = useState<LanguageKey>("eng")
  const [state, dispatch] = useImmerReducer(reducer, initialState)
  const [editField, setEditField] = useImmer({
    id: "",
    // language: "en"
  })
  const { fields } = state;
  const [loading, setLoading] = useState(false)
  const [loadingForm, setLoadingForm] = useState(true);


  /**
  On page load pull all the registration forms from the database, set the first one to state
  */
  useEffect(() => {
    axios.get(`${HIKMA_API}/admin_api/get_patient_registration_forms`, {
      headers: {
        Authorization: String(localStorage.getItem('token'))
      }
    }).then(res => {
      console.log({ forms: res.data })
      const { forms } = res.data;
      if (forms.length < 1) {
        return console.warn("There are no forms in the database")
      } else if (forms.length > 1) {
        console.warn("There are more than one forms in the database")
      }
      const form = forms[0] as unknown as RegistrationForm;
      // TODO: Extract out code for converting db object into usable object for re-use in the mobile client
      const savedForm: RegistrationForm = {
        id: form.id,
        name: decodeURI(form.name),
        fields: form.fields.map(field => ({
          ...field,
          label: mapObjectValues(field.label, decodeURI),
          options: field.options.map((opt) => mapObjectValues(opt, decodeURI)),
          column: decodeURI(field.column)
        })),
        createdAt: form.createdAt,
        updatedAt: form.updatedAt,
        metadata: form.metadata
      };

      console.log(savedForm);
      dispatch({ type: "set-form-state", payload: { form: savedForm } })
    }).catch(error => {
      console.error(error)
    }).finally(() => {
      setLoadingForm(false);
    })
  }, [])

  const submit = () => {
    if (loading) return;
    const result = registrationFormSchema.safeParse(state);

    let ignoreErrors = false

    if (!result.success) {
      console.error(result.error);
      if (result.error.errors.find(err => err.path.includes("options"))) {
        // ther eis an error with one of the options supported for a select field
        return alert("Please make sure all select fields have at least one option")
      } else {
        ignoreErrors = window.confirm("Some fields of the form are incomplete or empty. Are you sure you want to continue?")
      }
    }

    if ((!result.success && ignoreErrors === true) || result.success === true) {
      setLoading(true)

      saveForm({
        ...state,
        updatedAt: new Date()
      })
        .then(res => { })
        .catch(error => {
          console.error({ error })
        }).finally(() => {
          setLoading(false)
        })
    }

    console.log(result)
  }


  console.log("RENDER")

  // const language = "en"
  return (
    <AppLayout isLoading={loadingForm} title="Patient Registration Form">
      <div className={tw("max-w-lg space-y-4 pt-6")}>
        <Select
          label="Language"
          placeholder="Choose"
          value={formLanguage}
          onChange={(lang) => setFormLanguage(String(lang))}
          data={[
            // TODO: Add support for filtering out existing translation
            { value: "en", label: "English" },
            { value: "es", label: "Spanish" },
            { value: "ar", label: "Arabic" },
          ]}
        />
      </div>

      <div className={tw("max-w-lg space-y-4 pt-6")}>
        {sortBy(fields, "position").map((field) => {
          const { baseField, id, label, options, position, fieldType, required } = field
          const isInEditMode = editField.id === id
          return (
            <div className={tw(`border border-[${isInEditMode ? "#1d4ed8" : "#555"}] rounded p-4`)} key={field.id}>

              {
                fieldType === 'select' && <OptionsInput key={id} field={{
                  fieldType: "options",
                  description: "",
                  options: translationObjectOptions(options, formLanguage),
                  name: getTranslation(label, formLanguage),
                  required
                }} />
              }

              {(fieldType === 'text' || fieldType === "number") && <FreeTextInput key={field.id} field={{
                name: getTranslation(label, formLanguage),
                inputType: fieldType,
                description: "",
                required
              }} />

              } {field.fieldType === 'date' && (
                <DatePickerInput
                  valueFormat="YYYY MMM DD"
                  description={""}
                  label={getTranslation(label, formLanguage)}
                  required={field.required}
                  placeholder="Pick date"
                  mx="auto"
                />
              )}


              {editField.id === "" && (
                <Flex>
                  <Button variant="subtle" onClick={
                    () => {
                      setEditField(draft => {
                        draft.id = id;
                      })
                    }
                  } compact>Edit Field</Button>

                  {baseField !== true && (
                    <Button variant="subtle" color={"red"} onClick={
                      () => dispatch({ type: "remove-field", payload: { id: field.id } })
                    } compact>Remove Field</Button>
                  )}
                </Flex>
              )}


              {editField.id === id &&
                <div className={tw("mt-6 border-t border-[#333] pt-6")}>
                  <Grid>
                    {
                      Object.keys(field.label).map(languageKey => {
                        return (
                          <Fragment key={languageKey}>
                            <Grid.Col span={4}>
                              <Select
                                label="Language"
                                placeholder="Choose"
                                value={languageKey}
                                disabled
                                data={[
                                  // TODO: Add support for filtering out existing translation
                                  { value: "en", label: "English" },
                                  { value: "es", label: "Spanish" },
                                  { value: "ar", label: "Arabic" },
                                ]}
                              />
                            </Grid.Col>
                            <Grid.Col span={8}>
                              <TextInput
                                label="Field Name"
                                value={getTranslation(label, languageKey)}
                                onChange={e => {
                                  dispatch({ type: "update-field-label", payload: { id: id, label: e.target.value, translation: languageKey } })
                                }} />
                            </Grid.Col>
                          </Fragment>
                        )
                      })
                    }

                    <Grid.Col span={12}>
                      <Select
                        label="Field Type"
                        placeholder="Choose"
                        value={fieldType}
                        onChange={fieldType => dispatch({ type: "update-field-type", payload: { id, type: fieldType as typeof inputTypes[number] } })}
                        data={inputTypes.map(iT => ({ label: iT, value: iT }))}
                      />
                    </Grid.Col>


                    {
                      fieldType === "select" && (
                        <Grid.Col span={12}>
                          Options

                          {
                            field.options.map((option, idx) => {
                              return (
                                <div key={idx}>
                                  <Grid columns={12}>
                                    <Grid.Col span={11} className={""}>
                                      <TextInput label={`Option ${idx + 1} (English)`} value={option.en} onChange={({ target: { value } }) => dispatch({
                                        type: "update-select-option-translation",
                                        payload: { id, index: idx, language: "en", value }
                                      })} />
                                    </Grid.Col>
                                    <Grid.Col span={1} className={tw("flex items-end justify-center")}>
                                      <Button size="sm" variant="subtle" onClick={() => dispatch({ type: "remove-select-option", payload: { id, index: idx } })}>
                                        <IconCircleMinus size={18} color="pink" />
                                      </Button>
                                    </Grid.Col>
                                  </Grid>

                                  <Flex gap={2}>
                                    <If show={!("es" in option)}>
                                      <Button variant="subtle" onClick={() => dispatch({
                                        type: "add-select-option-translation",
                                        payload: { id, index: idx, language: "es" }
                                      })}>+ Spanish</Button>
                                    </If>
                                    <If show={!("ar" in option)}>
                                      <Button variant="subtle" onClick={() => dispatch({
                                        type: "add-select-option-translation",
                                        payload: { id, index: idx, language: "ar" }
                                      })}>+ Arabic</Button>
                                    </If>
                                  </Flex>

                                  {/*Except for english, loop over the other languages and show them and their translations*/}
                                  <div className={tw("pl-8 space-y-2 pb-5")}>
                                    {
                                      Object.keys(option).filter(k => k !== "en").map(languageKey => (
                                        <Grid columns={12} key={languageKey}>
                                          <Grid.Col span={10}>
                                            <TextInput
                                              label={`Option ${idx + 1} (${friendlyLang(languageKey)})`}
                                              value={option[languageKey]}
                                              onChange={({ target: { value } }) => dispatch({
                                                type: "update-select-option-translation",
                                                payload: { id, index: idx, language: languageKey, value }
                                              })} />
                                          </Grid.Col>
                                          <Grid.Col span={2} className={tw("flex items-end")}>
                                            <Button size="sm" variant="subtle" onClick={() => dispatch({ type: "remove-select-option-translation", payload: { id, index: idx, language: languageKey } })}>
                                              <IconCircleMinus size={18} color="pink" />
                                            </Button>
                                          </Grid.Col>
                                        </Grid>
                                      ))
                                    }
                                  </div>
                                </div>
                              )
                            })
                          }

                          <Button fullWidth variant={"outline"} className={tw("my-2")} onClick={() => dispatch({ type: "add-select-option", payload: { id } })}>Add Select Option</Button>
                        </Grid.Col>
                      )
                    }


                    <Grid.Col span={12} className={tw("space-y-3")}>
                      <Checkbox checked={field.visible} onChange={() => dispatch({ type: "toggle-visibility", payload: { id } })} label="This field is visible to clinicians" />
                      <Checkbox checked={required} onChange={e => dispatch({ type: "toggle-field-required", payload: { id } })} label="This field is required" />
                    </Grid.Col>
                    <Grid.Col span={12}>
                      <NumberInput
                        label="Field Position"
                        placeholder=""
                        value={position}
                        onChange={e => dispatch({ type: "change-position", payload: { id, position: +e } })}
                      />
                    </Grid.Col>

                    <Grid.Col span={12}>
                      <Button variant={"subtle"} fullWidth onClick={() => {
                        setEditField(draft => {
                          draft.id = "";
                        })
                      }}>Save Changes</Button>
                    </Grid.Col>
                  </Grid>

                </div>
              }
            </div>
          )
        })}


        <Button onClick={() => dispatch({ type: "add-field" })} fullWidth>
          + Add Field
        </Button>


        <Button loading={loading} disabled={loading} className="mt-4" onClick={submit} fullWidth>
          {loading ? "Loading ..." : "Submit"}
        </Button>


      </div>
    </AppLayout>
  )
}


/**
Utility function that processes the values of an object

@param {Object} obj
@oaram {(v: any) => any} func
@returns {Object}
*/
function mapObjectValues<T>(obj: T, func: (v: any) => any): T {
  return Object.fromEntries(Object.entries(obj as any).map(([k, v]) => ([k, func(v)]))) as T;
}


/**
Given a language key, return the expanded version of the key

@param {LanguageKey} language
@returns {string}
*/
function friendlyLang(language: LanguageKey): string {
  switch (language) {
    case "es": {
      return "Spanish"
    }
    case "ar": {
      return "Arabic"
    }
    case "en": {
      return "English"
    }
    default: {
      return language
    }
  }
}


/**
Given a translation object and a language key to, return that language label, or default to the english version.
If the english version does not exist, return any.

@param {TranslationObject} translations
@param {string} language
@return {string} translation
*/
function getTranslation(translations: TranslationObject, language: string): string {
  const translationKeys = Object.keys(translations);

  // in the case of no translations, return an empty string
  if (translationKeys.length === 0) {
    return ""
  } if (language in translations) {
    return translations[language]
  } else if (translations.en) {
    return translations.en
  } else {
    return translations[translationKeys[0]]
  }
}
