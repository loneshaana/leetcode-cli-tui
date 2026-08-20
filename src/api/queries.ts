export const QUESTION_DATA = /* GraphQL */ `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    content
    difficulty
    isPaidOnly
    exampleTestcases
    sampleTestCase
    metaData
    hints
    codeSnippets {
      lang
      langSlug
      code
    }
    topicTags {
      name
      slug
    }
  }
}
`;

export const PROBLEM_LIST = /* GraphQL */ `
query problemsetQuestionList(
  $categorySlug: String
  $limit: Int
  $skip: Int
  $filters: QuestionListFilterInput
) {
  problemsetQuestionList: questionList(
    categorySlug: $categorySlug
    limit: $limit
    skip: $skip
    filters: $filters
  ) {
    total: totalNum
    questions: data {
      frontendQuestionId: questionFrontendId
      title
      titleSlug
      difficulty
      status
      isPaidOnly
      acRate
    }
  }
}
`;

export const CURRENT_USER = /* GraphQL */ `
query globalData {
  userStatus {
    userId
    username
    isSignedIn
  }
}
`;

export const DAILY_QUESTION = /* GraphQL */ `
query questionOfToday {
  activeDailyCodingChallengeQuestion {
    date
    link
    question {
      titleSlug
      title
      frontendQuestionId: questionFrontendId
      difficulty
    }
  }
}
`;
